# Phone Push Notifications + Live-View Companion PWA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a pomodoro phase ends on the Windows desktop, push a notification to Joe's Android phone, and let an installed companion PWA show the live phase + countdown + ETA — at $0 with no inbound attack surface on the PC.

**Architecture:** The desktop app (Tauri/Rust) is the sender. The phone PWA subscribes to Web Push and sends its subscription to the PC once (one-time copy-paste pairing). On every timer state change the frontend invokes a Rust `push_state` command, which signs a VAPID JWT, encrypts a JSON payload, and POSTs it outbound to the phone's push endpoint (Google FCM). The PC never listens for inbound connections. The PWA renders a local countdown from the last pushed `etaEpochMs`.

**Tech Stack:** Tauri 2.11 + Rust, lit-html/vite frontend, `web-push 0.11` (hyper-client) + `openssl 0.10.72` (vendored) + `base64 0.22` on the Rust side, a static PWA (HTML + service worker) hosted on GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-05-29-phone-push-companion-design.md`

**API note:** All `web-push` code below targets **v0.11.0**. If a signature differs at implementation time, consult <https://docs.rs/web-push/0.11.0>. Where the exact `WebPushError` variant names matter, verify against that doc.

---

## Shared contract (read before any task)

**Push payload** — the JSON the desktop sends and the service worker receives. This shape is referenced by Tasks 3, 5, and 7; keep it identical in all three.

```jsonc
{
  "phase": "work",            // "work" | "short" | "long" | "other"
  "running": true,
  "etaEpochMs": 1717000000000, // epoch ms when the running phase ends; 0 when paused
  "remainingSec": 1500,        // remaining seconds at updatedAtMs (for paused display)
  "event": "phase-end",        // "phase-end" | "start" | "pause" | "skip" | "test"
  "endedPhase": "work",        // present only when event == "phase-end"
  "updatedAtMs": 1716998500000,
  "workSessionsCompleted": 2
}
```

**Pairing code** — the PWA produces `btoa(JSON.stringify(subscription.toJSON()))` where `subscription.toJSON()` is `{endpoint, keys:{p256dh, auth}}`. The desktop base64-decodes and parses it. (Plain `btoa`/base64, not base64url, to keep both sides trivial.)

**VAPID public key** — base64url-encoded uncompressed EC P-256 point (65 bytes → ~88 chars). Embedded in the PWA as `applicationServerKey`. Generated on the PC (Task 2).

---

## File structure

**Desktop (Rust):**
- Create `src-tauri/src/push/mod.rs` — push module entry: payload types, send logic, error classification.
- Create `src-tauri/src/push/vapid.rs` — VAPID keypair generation + public-key formatting.
- Modify `src-tauri/src/settings.rs` — new settings fields (struct + `Default`) + first-run VAPID generation.
- Modify `src-tauri/src/ipc/commands.rs` — new commands: `push_state`, `send_test_push`, `pair_phone`, `get_pairing_status`, `get_vapid_public_key`.
- Modify `src-tauri/src/lib.rs` — register new commands; generate VAPID keys on setup.
- Modify `src-tauri/Cargo.toml` — add crates.

**Frontend (TS):**
- Modify `src/main.ts` — `pushState(event)` helper + calls in phase/state handlers + a `push-subscription-gone` event listener.
- Modify `src/views/settings/schema.ts` — toggles, pairing field, test-push button.

**PWA (static, new):**
- Create `pwa/index.html` — enable/pair UI + live view.
- Create `pwa/manifest.webmanifest` — installability.
- Create `pwa/sw.js` — service worker (push handler + state cache).
- Create `pwa/app.js` — subscribe, pairing-code display, live countdown.
- Create `pwa/icon-192.png`, `pwa/icon-512.png` — reuse `src/favicon.png` scaled.

**CI:**
- Modify `.github/workflows/release.yml` — web-push build gate.

---

## Part A — Desktop sender

### Task 1: Add crates + settings fields

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/settings.rs:6-92`
- Modify: `src/views/settings/schema.ts`
- Test: `src-tauri/src/settings.rs` (inline `#[cfg(test)]` module)

- [ ] **Step 1: Add dependencies to `Cargo.toml`**

In `[dependencies]` of `src-tauri/Cargo.toml`, add:

```toml
web-push = { version = "0.11", default-features = false, features = ["hyper-client"] }
openssl = { version = "0.10.72", features = ["vendored"] }
base64 = "0.22"
```

- [ ] **Step 2: Verify the dependency tree builds**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles (vendored OpenSSL builds from source on first run — may take a few minutes). If OpenSSL fails to build on Windows, confirm Perl + NASM are on PATH (vendored openssl-src needs them); this is the exact risk the CI gate in Task 9 guards.

- [ ] **Step 3: Add fields to the `Settings` struct**

In `src-tauri/src/settings.rs`, inside `pub struct Settings { ... }` (before the `#[serde(flatten)] pub kit:` line), add:

```rust
    pub phone_notify_enabled: bool,
    pub notify_on_work_end: bool,
    pub notify_on_short_end: bool,
    pub notify_on_long_end: bool,
    pub push_subscription: Option<String>, // base64 of {endpoint,keys}; secret, local only
    pub vapid_private_key: String,         // PEM; secret, local only; generated first run
    pub vapid_public_key: String,          // base64url uncompressed point; for PWA/QR
```

- [ ] **Step 4: Add defaults to the `Default` impl**

In the `impl Default for Settings`, before `kit: KitSettings::default(),` add:

```rust
            phone_notify_enabled: false,
            notify_on_work_end: true,
            notify_on_short_end: true,
            notify_on_long_end: true,
            push_subscription: None,
            vapid_private_key: String::new(),
            vapid_public_key: String::new(),
```

- [ ] **Step 5: Write a serde round-trip test**

Append to `src-tauri/src/settings.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip_includes_push_fields() {
        let mut s = Settings::default();
        s.phone_notify_enabled = true;
        s.push_subscription = Some("abc123".into());
        s.vapid_private_key = "PEMDATA".into();
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back.phone_notify_enabled, true);
        assert_eq!(back.push_subscription.as_deref(), Some("abc123"));
        assert_eq!(back.vapid_private_key, "PEMDATA");
    }

    #[test]
    fn missing_push_fields_fall_back_to_default() {
        // Simulates an old settings file with no push fields (serde(default) on struct).
        let json = r#"{"work_minutes":25}"#;
        let s: Settings = serde_json::from_str(json).unwrap();
        assert_eq!(s.phone_notify_enabled, false);
        assert!(s.push_subscription.is_none());
    }
}
```

- [ ] **Step 6: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml settings::tests`
Expected: both tests PASS.

- [ ] **Step 7: Add the schema.ts fields**

In `src/views/settings/schema.ts`, add a new section (place near the existing notification/sound settings, following the established field-object pattern):

```typescript
{
  key: "phone_notify_enabled",
  kind: "toggle",
  label: "Notify my phone",
  tooltip: "Send a push to your paired Android phone when a phase ends. Requires pairing below.",
},
{
  key: "notify_on_work_end",
  kind: "toggle",
  label: "Notify on focus end",
  visibleWhen: (s) => s.phone_notify_enabled === true,
},
{
  key: "notify_on_short_end",
  kind: "toggle",
  label: "Notify on short break end",
  visibleWhen: (s) => s.phone_notify_enabled === true,
},
{
  key: "notify_on_long_end",
  kind: "toggle",
  label: "Notify on long break end",
  visibleWhen: (s) => s.phone_notify_enabled === true,
},
```

(The pairing field + test button are added in Task 6, after the backend commands exist.)

- [ ] **Step 8: Verify the frontend builds**

Run: `npm run build`
Expected: TypeScript compiles, no errors.

- [ ] **Step 9: Commit**

Stage `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/settings.rs`, `src/views/settings/schema.ts`. Commit via `/commit` (main agent only). Suggested message: `FEAT: add phone-push settings fields + crates`.

---

### Task 2: VAPID keypair generation

**Files:**
- Create: `src-tauri/src/push/vapid.rs`
- Create: `src-tauri/src/push/mod.rs` (module stub here; filled in Task 3)
- Modify: `src-tauri/src/lib.rs` (declare `mod push;` + generate on setup)
- Test: inline `#[cfg(test)]` in `vapid.rs`

- [ ] **Step 1: Create the module stub**

Create `src-tauri/src/push/mod.rs`:

```rust
pub mod vapid;
```

In `src-tauri/src/lib.rs`, near the other `mod` declarations, add:

```rust
mod push;
```

- [ ] **Step 2: Write the failing test first**

Create `src-tauri/src/push/vapid.rs` with only the test (function not yet defined):

```rust
use openssl::ec::{EcGroup, EcKey, PointConversionForm};
use openssl::bn::BigNumContext;
use openssl::nid::Nid;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

/// Generates a VAPID P-256 keypair.
/// Returns (private_key_pem, public_key_base64url_uncompressed).
pub fn generate_vapid_keypair() -> Result<(String, String), String> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_valid_keypair() {
        let (pem, pub_b64) = generate_vapid_keypair().unwrap();
        assert!(pem.contains("PRIVATE KEY"));
        // base64url uncompressed P-256 point = 65 bytes
        let raw = URL_SAFE_NO_PAD.decode(pub_b64).unwrap();
        assert_eq!(raw.len(), 65);
        assert_eq!(raw[0], 0x04); // uncompressed point marker
    }
}
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml vapid`
Expected: FAIL (panics at `todo!()`).

- [ ] **Step 4: Implement `generate_vapid_keypair`**

Replace the `todo!()` body:

```rust
pub fn generate_vapid_keypair() -> Result<(String, String), String> {
    let group = EcGroup::from_curve_name(Nid::X9_62_PRIME256V1).map_err(|e| e.to_string())?;
    let key = EcKey::generate(&group).map_err(|e| e.to_string())?;

    // Private key as SEC1 PEM ("EC PRIVATE KEY"), which web-push's VapidSignatureBuilder::from_pem reads.
    let pem_bytes = key.private_key_to_pem().map_err(|e| e.to_string())?;
    let pem = String::from_utf8(pem_bytes).map_err(|e| e.to_string())?;

    // Public key as uncompressed point, base64url no-pad (applicationServerKey format).
    let mut ctx = BigNumContext::new().map_err(|e| e.to_string())?;
    let point_bytes = key
        .public_key()
        .to_bytes(&group, PointConversionForm::UNCOMPRESSED, &mut ctx)
        .map_err(|e| e.to_string())?;
    let pub_b64 = URL_SAFE_NO_PAD.encode(point_bytes);

    Ok((pem, pub_b64))
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml vapid`
Expected: PASS.

- [ ] **Step 6: Generate keys on first run**

In `src-tauri/src/lib.rs`, in the `setup` closure after settings are loaded and before `handle.manage(SettingsState(...))` (around line 208), add:

```rust
// Generate VAPID keypair on first run so the private key never leaves this PC.
if settings.vapid_private_key.is_empty() {
    match push::vapid::generate_vapid_keypair() {
        Ok((pem, pubkey)) => {
            settings.vapid_private_key = pem;
            settings.vapid_public_key = pubkey;
            if let Err(e) = settings::persist(&handle, &settings) {
                log::warn!("failed to persist generated VAPID keys: {e}");
            } else {
                log::info!("generated VAPID keypair on first run");
            }
        }
        Err(e) => log::warn!("VAPID keygen failed: {e}"),
    }
}
```

(Ensure `settings` is `mut` at its binding in `setup`. If it is currently `let settings =`, change to `let mut settings =`.)

- [ ] **Step 7: Verify build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 8: Commit**

Stage `src-tauri/src/push/mod.rs`, `src-tauri/src/push/vapid.rs`, `src-tauri/src/lib.rs`. Commit via `/commit`. Suggested: `FEAT: generate VAPID keypair on first run`.

---

### Task 3: Push payload + send logic

**Files:**
- Modify: `src-tauri/src/push/mod.rs`
- Test: inline `#[cfg(test)]` in `mod.rs`

- [ ] **Step 1: Define payload + subscription types and the send classifier (with failing test)**

Replace `src-tauri/src/push/mod.rs` with:

```rust
pub mod vapid;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use web_push::{
    ContentEncoding, HyperWebPushClient, SubscriptionInfo, VapidSignatureBuilder,
    WebPushClient, WebPushError, WebPushMessageBuilder,
};

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

/// Outcome of a send attempt, so callers can react (e.g. clear a dead subscription).
#[derive(Debug, PartialEq)]
pub enum SendOutcome {
    Sent,
    SubscriptionGone, // 404/410 — the phone must re-pair
    Failed(String),   // transient/other — swallow, keep timer running
}

/// Parse the base64 pairing code (base64 of {endpoint,keys:{p256dh,auth}}) into SubscriptionInfo.
pub fn parse_subscription(code: &str) -> Result<SubscriptionInfo, String> {
    #[derive(Deserialize)]
    struct Keys { p256dh: String, auth: String }
    #[derive(Deserialize)]
    struct Sub { endpoint: String, keys: Keys }

    let bytes = STANDARD.decode(code.trim()).map_err(|e| format!("bad pairing code base64: {e}"))?;
    let sub: Sub = serde_json::from_slice(&bytes).map_err(|e| format!("bad pairing code json: {e}"))?;
    Ok(SubscriptionInfo::new(sub.endpoint, sub.keys.p256dh, sub.keys.auth))
}

/// Classify a WebPushError into a SendOutcome.
fn classify(err: WebPushError) -> SendOutcome {
    match err {
        // 404 / 410 from the push service: subscription no longer valid.
        WebPushError::EndpointNotFound | WebPushError::EndpointNotValid => SendOutcome::SubscriptionGone,
        other => SendOutcome::Failed(other.to_string()),
    }
}

/// Send a push. Async; callers spawn this so it never blocks the UI.
pub async fn send_push(
    vapid_private_pem: &str,
    subscription_code: &str,
    payload: &PushPayload,
) -> SendOutcome {
    let sub = match parse_subscription(subscription_code) {
        Ok(s) => s,
        Err(e) => return SendOutcome::Failed(e),
    };

    let sig = match VapidSignatureBuilder::from_pem(vapid_private_pem.as_bytes(), &sub) {
        Ok(b) => match b.build() {
            Ok(s) => s,
            Err(e) => return SendOutcome::Failed(e.to_string()),
        },
        Err(e) => return SendOutcome::Failed(e.to_string()),
    };

    let body = match serde_json::to_vec(payload) {
        Ok(b) => b,
        Err(e) => return SendOutcome::Failed(e.to_string()),
    };

    let mut builder = WebPushMessageBuilder::new(&sub);
    builder.set_payload(ContentEncoding::Aes128Gcm, &body);
    builder.set_vapid_signature(sig);
    // Urgency: high so Android Doze doesn't defer the notification.
    builder.set_urgency(web_push::Urgency::High);

    let message = match builder.build() {
        Ok(m) => m,
        Err(e) => return SendOutcome::Failed(e.to_string()),
    };

    let client = HyperWebPushClient::new();
    match client.send(message).await {
        Ok(()) => SendOutcome::Sent,
        Err(e) => classify(e),
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
    }

    #[test]
    fn parse_subscription_rejects_garbage() {
        assert!(parse_subscription("not-base64!!!").is_err());
    }

    #[test]
    fn payload_serializes_with_camelcase() {
        let p = PushPayload {
            phase: "work".into(), running: true, eta_epoch_ms: 100, remaining_sec: 60,
            event: "start".into(), ended_phase: None, updated_at_ms: 50, work_sessions_completed: 1,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"etaEpochMs\":100"));
        assert!(!json.contains("endedPhase")); // skipped when None
    }
}
```

- [ ] **Step 2: Run the tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml push::tests`
Expected: 3 tests PASS.
**If** `WebPushError::EndpointNotFound` / `EndpointNotValid` / `Urgency` / `set_urgency` names don't match v0.11, fix per <https://docs.rs/web-push/0.11.0> (the `classify`/urgency lines are the only likely deltas) and re-run.

- [ ] **Step 3: Commit**

Stage `src-tauri/src/push/mod.rs`. Commit via `/commit`. Suggested: `FEAT: web-push send logic + payload/subscription types`.

---

### Task 4: Tauri commands

**Files:**
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

- [ ] **Step 1: Add the commands**

Append to `src-tauri/src/ipc/commands.rs` (ensure imports for `AppHandle`, `State`, `SettingsState`, `tauri::Emitter`, and `crate::push`):

```rust
use crate::push::{self, PushPayload, SendOutcome};

#[tauri::command]
pub fn get_vapid_public_key(state: State<SettingsState>) -> String {
    state.0.lock().unwrap().vapid_public_key.clone()
}

#[tauri::command]
pub fn get_pairing_status(state: State<SettingsState>) -> bool {
    state.0.lock().unwrap().push_subscription.is_some()
}

#[tauri::command]
pub fn pair_phone(
    app: AppHandle,
    state: State<'_, SettingsState>,
    code: String,
) -> Result<(), String> {
    // Validate before storing.
    push::parse_subscription(&code)?;
    let settings = {
        let mut s = state.0.lock().unwrap();
        s.push_subscription = Some(code);
        s.clone()
    };
    crate::settings::persist(&app, &settings)?;
    log::info!("phone paired");
    Ok(())
}

/// Build the per-send inputs (private key + subscription) if push is enabled and paired.
fn push_inputs(state: &State<SettingsState>, payload: &PushPayload) -> Option<(String, String)> {
    let s = state.0.lock().unwrap();
    if !s.phone_notify_enabled {
        return None;
    }
    // Per-phase gating only applies to phase-end events.
    if payload.event == "phase-end" {
        let allowed = match payload.ended_phase.as_deref() {
            Some("work") => s.notify_on_work_end,
            Some("short") => s.notify_on_short_end,
            Some("long") => s.notify_on_long_end,
            _ => true,
        };
        if !allowed {
            // Still send state for the live view, but suppress the notification by
            // re-labeling the event so the SW won't showNotification (see SW logic).
            // Simplest: skip entirely for non-notifying phase ends.
            return None;
        }
    }
    let sub = s.push_subscription.clone()?;
    if s.vapid_private_key.is_empty() {
        return None;
    }
    Some((s.vapid_private_key.clone(), sub))
}

async fn do_send(app: AppHandle, pem: String, sub: String, payload: PushPayload) {
    match push::send_push(&pem, &sub, &payload).await {
        SendOutcome::Sent => {}
        SendOutcome::SubscriptionGone => {
            log::warn!("push subscription gone; clearing + prompting re-pair");
            // Clear the dead subscription and tell the UI.
            if let Some(state) = app.try_state::<SettingsState>() {
                let settings = {
                    let mut s = state.0.lock().unwrap();
                    s.push_subscription = None;
                    s.clone()
                };
                let _ = crate::settings::persist(&app, &settings);
            }
            let _ = app.emit("push-subscription-gone", ());
        }
        SendOutcome::Failed(e) => log::warn!("push send failed (ignored): {e}"),
    }
}

#[tauri::command]
pub fn push_state(app: AppHandle, state: State<SettingsState>, payload: PushPayload) {
    if let Some((pem, sub)) = push_inputs(&state, &payload) {
        tauri::async_runtime::spawn(do_send(app, pem, sub, payload));
    }
}

#[tauri::command]
pub fn send_test_push(app: AppHandle, state: State<SettingsState>) -> Result<(), String> {
    let (pem, sub) = {
        let s = state.0.lock().unwrap();
        let sub = s.push_subscription.clone().ok_or("phone not paired")?;
        if s.vapid_private_key.is_empty() {
            return Err("no VAPID key".into());
        }
        (s.vapid_private_key.clone(), sub)
    };
    let payload = PushPayload {
        phase: "other".into(),
        running: false,
        eta_epoch_ms: 0,
        remaining_sec: 0,
        event: "test".into(),
        ended_phase: None,
        updated_at_ms: 0, // frontend may overwrite; 0 acceptable for a test
        work_sessions_completed: 0,
    };
    tauri::async_runtime::spawn(do_send(app, pem, sub, payload));
    Ok(())
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, add to the `generate_handler![...]` list (after `heartbeat_stats,`):

```rust
    get_vapid_public_key,
    get_pairing_status,
    pair_phone,
    push_state,
    send_test_push,
```

Ensure these are imported wherever the other `commands::*` are brought into scope for the macro.

- [ ] **Step 3: Verify build**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: compiles. Fix any `Emitter`/`try_state` import (`use tauri::{Emitter, Manager};`).

- [ ] **Step 4: Commit**

Stage `src-tauri/src/ipc/commands.rs`, `src-tauri/src/lib.rs`. Commit via `/commit`. Suggested: `FEAT: push_state/test/pair Tauri commands`.

---

### Task 5: Frontend state hooks

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add the `pushState` helper**

In `src/main.ts`, near the other `invoke` usages, add:

```typescript
function pushState(event: string, endedPhase?: string) {
  const nowMs = Date.now();
  const etaEpochMs = running && remainingSec > 0 ? nowMs + remainingSec * 1000 : 0;
  const payload = {
    phase,
    running,
    etaEpochMs,
    remainingSec,
    event,
    endedPhase,
    updatedAtMs: nowMs,
    workSessionsCompleted,
  };
  invoke("push_state", { payload }).catch((e) => console.warn("push_state failed", e));
}
```

- [ ] **Step 2: Call it from the state-change points**

- In `startTimer()` after `running = true` (and tray set), add: `pushState("start");`
- In `pauseTimer(endedBy)` after `running = false`, add: `pushState("pause");`
- In `handlePhaseEnd(natural)`: capture the ending phase BEFORE `setPhaseInternal` changes it, then push. After `pauseTimer()` (line ~250) and after the next phase is computed, add near where `setPhaseInternal(next)` is called:

```typescript
const endedPhaseForPush = phase; // current phase is the one that just ended
// ... existing next-phase logic that calls setPhaseInternal(next) ...
pushState("phase-end", endedPhaseForPush);
```

Place `pushState("phase-end", endedPhaseForPush)` AFTER `setPhaseInternal(next)` so `phase` reflects the new phase and `etaEpochMs` reflects the new phase's countdown (the payload then says "work just ended, now on short with ETA X"). Skip events (which also call `handlePhaseEnd`) are covered by this same call; the `event` stays `"phase-end"` which is correct for the notification.

- [ ] **Step 3: Listen for the re-pair event**

Near app boot in `src/main.ts` (where other `listen`/event wiring lives, using `window.__TAURI__.event`):

```typescript
const { listen } = window.__TAURI__.event;
listen("push-subscription-gone", () => {
  console.warn("phone unpaired by push service; re-pair needed");
  // Surfaced in the settings UI (Task 6). Here just log; settings window shows the banner.
});
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: TypeScript compiles.

- [ ] **Step 5: Manual verification note**

Playwright cannot reach the Tauri webview (`window.__TAURI__` is undefined in a plain browser — see project memory), so these hooks can only be verified in the running app. Defer to the Task 10 manual QA checklist. Do NOT claim runtime success from a build pass alone.

- [ ] **Step 6: Commit**

Stage `src/main.ts`. Commit via `/commit`. Suggested: `FEAT: push timer state on phase/start/pause changes`.

---

### Task 6: Settings UI — pairing field, test button, re-pair banner

**Files:**
- Modify: `src/views/settings/schema.ts`
- Modify: the settings view renderer (the file that renders schema entries; locate via the `kind` switch — likely `src/views/settings/*.ts` or the kit frontend `vendor/tauri_kit/frontend/settings/`)

- [ ] **Step 1: Decide where the pairing UI lives**

The pairing UI needs custom rendering (paste field + "Pair" button + status + "Send test" button + re-pair banner) beyond a plain schema field. Locate the schema renderer's `kind` switch. If it supports a custom/component kind, add one; otherwise add a small dedicated block in the settings HTML/template.

- [ ] **Step 2: Add the pairing UI**

Add a lit-html block (in the settings view) bound to these handlers:

```typescript
const { invoke } = window.__TAURI__.core;

async function refreshPairing() {
  const paired = await invoke("get_pairing_status");
  // render: paired ? "Paired ✓" : "Not paired"
}

async function pairFromCode(code: string) {
  try {
    await invoke("pair_phone", { code });
    await refreshPairing();
  } catch (e) {
    // show error: invalid pairing code
  }
}

async function sendTest() {
  try {
    await invoke("send_test_push");
    // toast: "Test sent — check your phone"
  } catch (e) {
    // toast: e (e.g. "phone not paired")
  }
}
```

Template (adapt to the project's settings styling):

```typescript
html`
  <div class="setting-row">
    <label>Pair phone</label>
    <input id="pair-code" type="text" placeholder="Paste pairing code from the PWA" />
    <button @click=${() => pairFromCode((document.getElementById('pair-code') as HTMLInputElement).value)}>Pair</button>
  </div>
  <div class="setting-row">
    <button @click=${sendTest}>Send test push</button>
  </div>
`
```

- [ ] **Step 3: Add the re-pair banner**

Listen for `push-subscription-gone` in the settings view and render a dismissible banner: "Your phone was unpaired by the push service. Re-pair to keep getting alerts." Reuse the event-listen pattern from Task 5 Step 3.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles.

- [ ] **Step 5: Manual verification note**

Tauri-webview only; verify in the running app (Task 10). Build pass ≠ runtime pass.

- [ ] **Step 6: Commit**

Stage the settings view files + `schema.ts`. Commit via `/commit`. Suggested: `FEAT: settings pairing UI + test-push + re-pair banner`.

---

## Part B — Companion PWA

### Task 7: PWA static files

**Files:**
- Create: `pwa/index.html`, `pwa/app.js`, `pwa/sw.js`, `pwa/manifest.webmanifest`, `pwa/icon-192.png`, `pwa/icon-512.png`

- [ ] **Step 1: Manifest**

Create `pwa/manifest.webmanifest`:

```json
{
  "name": "Pomodoro Companion",
  "short_name": "Pomodoro",
  "start_url": "./index.html",
  "display": "standalone",
  "background_color": "#1e1e1e",
  "theme_color": "#1e1e1e",
  "icons": [
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: Icons**

Copy `src/favicon.png` to `pwa/icon-512.png` and a 192px scaled copy to `pwa/icon-192.png`. (Do NOT overwrite the source favicon — see project rule.)

Run (PowerShell): `Copy-Item src/favicon.png pwa/icon-512.png`
For 192: any scaler, or reuse the 512 as both if a scaler isn't handy (acceptable for a personal tool).

- [ ] **Step 3: index.html**

Create `pwa/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Pomodoro Companion</title>
  <link rel="manifest" href="manifest.webmanifest" />
  <meta name="theme-color" content="#1e1e1e" />
  <style>
    body { margin:0; font-family: system-ui, sans-serif; background:#1e1e1e; color:#eee; text-align:center; }
    main { max-width:480px; margin:0 auto; padding:24px; }
    .phase { font-size:1.2rem; text-transform:capitalize; opacity:0.8; }
    .count { font-size:4rem; font-variant-numeric:tabular-nums; margin:8px 0; }
    .eta, .stale { opacity:0.6; font-size:0.9rem; }
    button { font-size:1rem; padding:12px 20px; border-radius:10px; border:0; margin:8px; }
    #code { width:100%; word-break:break-all; background:#2a2a2a; padding:12px; border-radius:8px; user-select:all; font-size:0.75rem; }
    #qr { margin:12px auto; }
  </style>
</head>
<body>
  <main>
    <div id="live" hidden>
      <div class="phase" id="phase">-</div>
      <div class="count" id="count">--:--</div>
      <div class="eta" id="eta"></div>
      <div class="stale" id="stale"></div>
    </div>
    <button id="enable">Enable notifications</button>
    <div id="pairing" hidden>
      <p>Paste this code into the desktop app's settings → Pair phone:</p>
      <div id="code"></div>
      <button id="copy">Copy code</button>
      <canvas id="qr"></canvas>
    </div>
    <p id="status"></p>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

(Verify the `qrcode` CDN package is legit before relying on it — it is the widely-used `qrcode` npm package; the safety-check rule applies even for a CDN script. If preferred, vendor the file instead of CDN.)

- [ ] **Step 4: app.js (subscribe + pairing + live view)**

Create `pwa/app.js`:

```javascript
// __VAPID_PUBLIC_KEY__ is replaced at deploy time (Task 8).
const VAPID_PUBLIC_KEY = "__VAPID_PUBLIC_KEY__";

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enable() {
  const reg = await navigator.serviceWorker.register("sw.js");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") { setStatus("Notifications blocked"); return; }
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const code = btoa(JSON.stringify(sub.toJSON()));
  showPairing(code);
}

function showPairing(code) {
  document.getElementById("enable").hidden = true;
  const pairing = document.getElementById("pairing");
  pairing.hidden = false;
  document.getElementById("code").textContent = code;
  document.getElementById("copy").onclick = () => navigator.clipboard.writeText(code);
  if (window.QRCode) QRCode.toCanvas(document.getElementById("qr"), code, { width: 220 });
}

function setStatus(s) { document.getElementById("status").textContent = s; }

// ---- Live view: render from last pushed state (stored by the SW) ----
let latest = null;
function render() {
  if (!latest) return;
  document.getElementById("live").hidden = false;
  document.getElementById("phase").textContent = latest.phase;
  const now = Date.now();
  let remaining;
  if (latest.running && latest.etaEpochMs > 0) {
    remaining = Math.max(0, Math.round((latest.etaEpochMs - now) / 1000));
    const eta = new Date(latest.etaEpochMs);
    document.getElementById("eta").textContent =
      "Ends ~" + eta.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    remaining = latest.remainingSec || 0;
    document.getElementById("eta").textContent = "Paused";
  }
  const m = String(Math.floor(remaining / 60)).padStart(2, "0");
  const s = String(remaining % 60).padStart(2, "0");
  document.getElementById("count").textContent = `${m}:${s}`;
  const ageSec = Math.round((now - (latest.updatedAtMs || now)) / 1000);
  document.getElementById("stale").textContent =
    ageSec > 90 ? `updated ${Math.round(ageSec / 60)}m ago` : "";
}
setInterval(render, 1000);

// Receive state pushed from the SW (postMessage) and on load (from cache).
navigator.serviceWorker.addEventListener("message", (e) => {
  if (e.data?.type === "state") { latest = e.data.data; render(); }
});
async function loadCachedState() {
  try {
    const cache = await caches.open("pomodoro-state");
    const res = await cache.match("state");
    if (res) { latest = await res.json(); render(); }
  } catch {}
}

document.getElementById("enable").onclick = () => enable().catch((e) => setStatus(String(e)));
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then(loadCachedState);
}
```

- [ ] **Step 5: sw.js (push handler + state cache)**

Create `pwa/sw.js`:

```javascript
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const PHASE_LABEL = { work: "Focus", short: "Short break", long: "Long break", other: "Pomodoro" };

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data.json(); } catch {}
  event.waitUntil((async () => {
    // 1. Persist latest state for the live view.
    try {
      const cache = await caches.open("pomodoro-state");
      await cache.put("state", new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json" },
      }));
    } catch {}

    // 2. Forward to any open page.
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    clients.forEach((c) => c.postMessage({ type: "state", data }));

    // 3. Show a notification only on phase-end and test events.
    if (data.event === "phase-end") {
      const ended = PHASE_LABEL[data.endedPhase] || "Phase";
      const next = PHASE_LABEL[data.phase] || "";
      await self.registration.showNotification(`${ended} done`, {
        body: next ? `Now: ${next}` : "Time's up",
        icon: "icon-192.png",
        tag: "pomodoro-phase",
        renotify: true,
      });
    } else if (data.event === "test") {
      await self.registration.showNotification("Test push", {
        body: "Your phone is paired correctly.",
        icon: "icon-192.png",
        tag: "pomodoro-test",
      });
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("./index.html"));
});
```

- [ ] **Step 6: Local sanity check (desktop browser)**

Serve `pwa/` over localhost (localhost is a secure context, so SW + push registration work):
Run (PowerShell): `npx --yes http-server pwa -p 5055`
Open `http://localhost:5055` in Chrome, click Enable. Expected: permission prompt, then a pairing code + QR render. (Actual delivery needs the desktop sender + a real subscription; full path is Task 10.) Verify the `qrcode` CDN package legitimacy before this step per the safety rule. Kill the server when done (`Ctrl-C`; ensure no orphan node process remains).

- [ ] **Step 7: Commit**

Stage the `pwa/` files. Commit via `/commit`. Suggested: `FEAT: companion PWA (subscribe, pairing, live view, SW)`.

---

### Task 8: Deploy the PWA to GitHub Pages

**Files:**
- Possibly modify: repo Pages config / a deploy step; inject VAPID public key.

- [ ] **Step 1: Get the VAPID public key**

Run the desktop app once (so first-run keygen happens), then read `vapid_public_key` from the persisted settings file (location per `tauri_kit_settings`; typically `%APPDATA%/<app>/`), OR add a temporary log line. This key is public and safe to embed.

- [ ] **Step 2: Inject the key into `app.js`**

Replace `__VAPID_PUBLIC_KEY__` in `pwa/app.js` with the actual base64url key. (Public key only — never the private PEM.)

- [ ] **Step 3: Publish via GitHub Pages**

Use the `/github-pages-init` skill, OR configure Pages to serve the `pwa/` folder (e.g. move to `docs/` and set Pages source to `/docs`, or push `pwa/` contents to a `gh-pages` branch). Confirm the resulting HTTPS URL loads `index.html`.

- [ ] **Step 4: Confirm HTTPS + installability**

Open the Pages URL on desktop Chrome → DevTools → Application → Manifest: no errors, installable. (Service workers require HTTPS, which Pages provides.)

- [ ] **Step 5: Commit**

Stage the Pages files / config. Commit via `/commit`. Suggested: `CHORE: deploy companion PWA to GitHub Pages`.

> **Secret guard:** before committing, confirm the only VAPID material in the repo is the PUBLIC key. Grep the staged diff for `PRIVATE KEY` and for any `push_subscription` value — neither may ever be committed.

---

### Task 9: CI build gate for web-push

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add a build-gate step**

In `.github/workflows/release.yml`, between "Install Tauri CLI" and "Build" (around line 94-99), add:

```yaml
      - name: Verify web-push crate compiles (crypto-dep gate)
        working-directory: src-tauri
        run: cargo check --locked
```

This fails the release early if the `web-push` / vendored-`openssl` toolchain regresses on the Windows runner, before the long `cargo tauri build`.

- [ ] **Step 2: Confirm the runner has OpenSSL build prereqs**

Vendored OpenSSL needs Perl + NASM on the runner. The GitHub `windows-latest` image ships Strawberry Perl and NASM, so no extra install is normally required. If the gate fails on missing NASM/Perl, add a setup step (`choco install nasm` / ensure Perl on PATH) before the gate.

- [ ] **Step 3: Verify YAML**

Run (PowerShell): `npx --yes yaml-lint .github/workflows/release.yml` (or visual review).
Expected: valid YAML. Kill any orphan node process after.

- [ ] **Step 4: Commit**

Stage `.github/workflows/release.yml`. Commit via `/commit`. Suggested: `CHORE: CI gate compiling web-push before release`.

---

### Task 10: Manual QA checklist (Joe's Android phone)

These steps require Joe's physical phone and the running desktop app; they cannot be automated (Tauri webview is unreachable by Playwright; Web Push delivery needs a real device). Add them to `.for_bepy/BEPY_TODOS.md` under `### Visual QA` if handing off, or walk through together.

- [ ] Build + run the desktop app (`npm run tauri dev`); confirm it starts and VAPID keys were generated (log line / settings file).
- [ ] On Android Chrome, open the GitHub Pages PWA URL; "Add to Home screen" to install.
- [ ] Open the installed PWA, tap **Enable notifications**, grant permission; confirm a pairing code + QR appear.
- [ ] Copy the pairing code to the PC (Phone Link shared clipboard, or message-to-self); paste into desktop settings → **Pair phone**; confirm "Paired ✓".
- [ ] In desktop settings, enable **Notify my phone**; click **Send test push**; confirm the phone shows "Test push" within a few seconds (phone screen off too).
- [ ] Start a short work timer; let it end naturally; confirm the phone shows "Focus done / Now: Short break".
- [ ] Open the PWA; confirm it shows the current phase, a live ticking countdown, and an "Ends ~HH:MM" ETA.
- [ ] Toggle off "Notify on focus end"; end a focus phase; confirm NO notification fires (live view may still update or be suppressed — acceptable either way).
- [ ] Put the PC to sleep; confirm the PWA shows "updated Nm ago" staleness, and no crash on the desktop.
- [ ] (Expiry path, optional) Clear the PWA's site data to invalidate the subscription, then trigger a push; confirm the desktop logs "subscription gone" and the settings re-pair banner appears.

---

## Self-review notes

- **Spec coverage:** notifications (Tasks 3-5,7), live view (Tasks 5,7), $0/no-inbound (architecture; Task 3-4 outbound-only), Android-only (no iOS code), one-time pairing (Tasks 4,6,7), high-urgency (Task 3), 410 re-pair (Tasks 4,6,7), test push (Tasks 4,6), CI gate (Task 9), secrets never in repo (Tasks 2,8 guard), settings persist in both schema + struct (Task 1) — all mapped.
- **Known accuracy risks to verify at execution time:** exact `web-push 0.11` API names for `WebPushError` variants and `set_urgency`/`Urgency` (Task 3 Step 2); the SEC1-vs-PKCS8 PEM format accepted by `VapidSignatureBuilder::from_pem` (Task 2 — if `from_pem` rejects SEC1, switch to `private_key_to_pem_pkcs8`); the settings renderer's extensibility for the custom pairing UI (Task 6 Step 1).
- **Untestable-by-Claude:** all real push delivery + PWA-on-phone behavior (Task 10) — gated to manual QA, never claimed from a build pass.
