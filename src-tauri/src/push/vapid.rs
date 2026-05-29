use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::pkcs8::EncodePrivateKey;
use p256::SecretKey;
use rand_core::OsRng;

/// Generates a VAPID P-256 keypair.
/// Returns (private_key_pkcs8_pem, public_key_base64url_uncompressed).
/// The PEM is consumed later by jwt_simple::ES256KeyPair::from_pem; the base64url
/// public key is the PWA's `applicationServerKey`.
pub fn generate_vapid_keypair() -> Result<(String, String), String> {
    // Generate a P-256 secret key with the OS CSPRNG.
    let secret = SecretKey::random(&mut OsRng);

    // Private key as PKCS#8 PEM ("PRIVATE KEY"); jwt-simple's ES256KeyPair::from_pem reads it.
    let pem = secret
        .to_pkcs8_pem(p256::pkcs8::LineEnding::LF)
        .map_err(|e| e.to_string())?
        .to_string();

    // Public key as uncompressed SEC1 point (65 bytes, 0x04-prefixed), base64url no-pad
    // — the format the browser expects for applicationServerKey.
    let point = secret.public_key().to_encoded_point(false);
    let pub_b64 = URL_SAFE_NO_PAD.encode(point.as_bytes());

    Ok((pem, pub_b64))
}

#[cfg(test)]
mod tests {
    use super::*;
    use jwt_simple::algorithms::ES256KeyPair;

    #[test]
    fn generates_valid_keypair() {
        let (pem, pub_b64) = generate_vapid_keypair().unwrap();
        assert!(pem.contains("PRIVATE KEY"));
        let raw = URL_SAFE_NO_PAD.decode(pub_b64).unwrap();
        assert_eq!(raw.len(), 65);
        assert_eq!(raw[0], 0x04);
        ES256KeyPair::from_pem(&pem).expect("jwt-simple must accept our PKCS8 PEM");
    }
}
