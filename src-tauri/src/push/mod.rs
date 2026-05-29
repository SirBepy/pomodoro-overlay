pub mod vapid;

use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine as _};
use jwt_simple::algorithms::ES256KeyPair;
use p256::PublicKey;
use serde::{Deserialize, Serialize};
use web_push_native::{Auth, WebPushBuilder};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct PushPayload {
    pub phase: String,
    pub running: bool,
    #[serde(rename = "etaEpochMs")]
    pub eta_epoch_ms: u64,
    #[serde(rename = "remainingSec")]
    pub remaining_sec: u64,
    pub event: String,
    #[serde(rename = "endedPhase", skip_serializing_if = "Option::is_none")]
    pub ended_phase: Option<String>,
    #[serde(rename = "updatedAtMs")]
    pub updated_at_ms: u64,
    #[serde(rename = "workSessionsCompleted")]
    pub work_sessions_completed: u32,
}

#[derive(Debug, PartialEq)]
pub enum SendOutcome {
    Sent,
    SubscriptionGone, // 404/410 — the phone must re-pair
    Failed(String),   // transient/other — swallow, keep timer running
}

#[derive(Debug, Deserialize)]
pub struct Subscription {
    pub endpoint: String,
    pub p256dh: String, // base64url
    pub auth: String,   // base64url
}

/// Parse the base64 (standard) pairing code of `{endpoint, keys:{p256dh, auth}}`.
pub fn parse_subscription(code: &str) -> Result<Subscription, String> {
    #[derive(Deserialize)]
    struct Keys { p256dh: String, auth: String }
    #[derive(Deserialize)]
    struct Sub { endpoint: String, keys: Keys }

    let bytes = STANDARD.decode(code.trim()).map_err(|e| format!("bad pairing code base64: {e}"))?;
    let sub: Sub = serde_json::from_slice(&bytes).map_err(|e| format!("bad pairing code json: {e}"))?;
    Ok(Subscription { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth })
}

/// Decode a base64url `auth` secret into web-push-native's 16-byte `Auth`.
/// Returns Err (never panics) if the value isn't exactly 16 bytes. The value
/// comes from the pairing code and is untrusted, and `Auth::clone_from_slice`
/// panics on a length mismatch — so the length is checked first.
fn decode_auth(auth_b64url: &str) -> Result<Auth, String> {
    let bytes = URL_SAFE_NO_PAD
        .decode(auth_b64url.trim_end_matches('='))
        .map_err(|e| format!("bad auth base64: {e}"))?;
    if bytes.len() != 16 {
        return Err(format!("bad auth: expected 16 bytes, got {}", bytes.len()));
    }
    Ok(Auth::clone_from_slice(&bytes))
}

/// Send a push. Async (reqwest); callers spawn this so it never blocks the UI.
/// `contact` must be a `mailto:` or `https:` URL (VAPID `sub` claim).
pub async fn send_push(
    vapid_private_pem: &str,
    subscription_code: &str,
    payload: &PushPayload,
    contact: &str,
) -> SendOutcome {
    let sub = match parse_subscription(subscription_code) {
        Ok(s) => s,
        Err(e) => return SendOutcome::Failed(e),
    };

    let ua_public = match URL_SAFE_NO_PAD
        .decode(sub.p256dh.trim_end_matches('='))
        .map_err(|e| e.to_string())
        .and_then(|b| PublicKey::from_sec1_bytes(&b).map_err(|e| e.to_string()))
    {
        Ok(k) => k,
        Err(e) => return SendOutcome::Failed(format!("bad p256dh: {e}")),
    };
    let ua_auth = match decode_auth(&sub.auth) {
        Ok(a) => a,
        Err(e) => return SendOutcome::Failed(e),
    };

    let vapid_kp = match ES256KeyPair::from_pem(vapid_private_pem) {
        Ok(k) => k,
        Err(e) => return SendOutcome::Failed(format!("bad vapid key: {e}")),
    };

    let body = match serde_json::to_vec(payload) {
        Ok(b) => b,
        Err(e) => return SendOutcome::Failed(e.to_string()),
    };

    let endpoint_uri = match sub.endpoint.parse() {
        Ok(u) => u,
        Err(e) => return SendOutcome::Failed(format!("bad endpoint: {e}")),
    };

    let request = match WebPushBuilder::new(endpoint_uri, ua_public, ua_auth)
        .with_vapid(&vapid_kp, contact)
        .build(body)
    {
        Ok(r) => r,
        Err(e) => return SendOutcome::Failed(format!("build push: {e}")),
    };

    let (parts, body) = request.into_parts();
    let client = reqwest::Client::new();
    let mut rb = client.post(parts.uri.to_string());
    for (name, value) in parts.headers.iter() {
        rb = rb.header(name.as_str(), value.as_bytes());
    }
    rb = rb.header("Urgency", "high");
    if !parts.headers.contains_key("ttl") {
        rb = rb.header("TTL", "60");
    }

    match rb.body(body).send().await {
        Ok(resp) => {
            let code = resp.status().as_u16();
            if resp.status().is_success() {
                SendOutcome::Sent
            } else if code == 404 || code == 410 {
                SendOutcome::SubscriptionGone
            } else {
                SendOutcome::Failed(format!("push endpoint returned {code}"))
            }
        }
        Err(e) => SendOutcome::Failed(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_subscription_roundtrip() {
        let json = r#"{"endpoint":"https://fcm.googleapis.com/x","keys":{"p256dh":"BPK","auth":"AAA"}}"#;
        let code = STANDARD.encode(json);
        let sub = parse_subscription(&code).unwrap();
        assert_eq!(sub.endpoint, "https://fcm.googleapis.com/x");
        assert_eq!(sub.p256dh, "BPK");
    }

    #[test]
    fn parse_subscription_rejects_garbage() {
        assert!(parse_subscription("not-base64!!!").is_err());
    }

    #[test]
    fn decode_auth_rejects_wrong_length() {
        // 4 bytes (untrusted, malformed) must Err, not panic.
        let short = URL_SAFE_NO_PAD.encode([1u8, 2, 3, 4]);
        assert!(decode_auth(&short).is_err());
    }

    #[test]
    fn decode_auth_accepts_16_bytes() {
        let ok = URL_SAFE_NO_PAD.encode([7u8; 16]);
        assert!(decode_auth(&ok).is_ok());
    }

    #[test]
    fn payload_serializes_with_camelcase() {
        let p = PushPayload {
            phase: "work".into(), running: true, eta_epoch_ms: 100, remaining_sec: 60,
            event: "start".into(), ended_phase: None, updated_at_ms: 50, work_sessions_completed: 1,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"etaEpochMs\":100"));
        assert!(!json.contains("endedPhase"));
    }
}
