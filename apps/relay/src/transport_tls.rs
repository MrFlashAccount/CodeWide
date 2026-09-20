//! Durable pinned TLS identity for the Relay-to-Companion service plane.
use crate::{Result, denied};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use rustls::{
    CertificateError, ClientConfig, DigitallySignedStruct, Error as TlsError, ServerConfig,
    SignatureScheme,
    client::{Resumption, danger::ServerCertVerifier},
    crypto::{WebPkiSupportedAlgorithms, verify_tls12_signature, verify_tls13_signature},
    pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime},
    version::TLS13,
};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::Path,
    sync::Arc,
};
use subtle::ConstantTimeEq;

const CERT_FILE: &str = "transport-cert.der";
const KEY_FILE: &str = "transport-key.der";
const PIN_PREFIX: &str = "sha256/";

/// Relay-owned certificate and private key persisted in its private state directory.
pub struct RelayTlsIdentity {
    certificate: Vec<u8>,
    private_key: Vec<u8>,
}

impl RelayTlsIdentity {
    /// Loads the durable identity or creates it once when neither identity file exists.
    /// # Errors
    /// Rejects partial, non-regular, or group/world-readable identity state.
    pub fn load_or_create(root: &Path) -> Result<Self> {
        let certificate_path = root.join(CERT_FILE);
        let private_key_path = root.join(KEY_FILE);
        match (certificate_path.exists(), private_key_path.exists()) {
            (true, true) => Self::load(&certificate_path, &private_key_path),
            (false, false) => Self::create(&certificate_path, &private_key_path),
            _ => Err(std::io::Error::other("relay TLS identity is incomplete").into()),
        }
    }

    /// Returns the exact SHA-256 leaf-certificate pin copied in an invitation bundle.
    #[must_use]
    pub fn pin(&self) -> String {
        encode_pin(digest(&self.certificate))
    }

    /// Builds a TLS 1.3-only server config without tickets or early data.
    /// # Errors
    /// Rejects an invalid persisted certificate or private key.
    pub fn server_config(&self) -> Result<Arc<ServerConfig>> {
        let provider = rustls::crypto::ring::default_provider();
        let mut config = ServerConfig::builder_with_provider(Arc::new(provider))
            .with_protocol_versions(&[&TLS13])?
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(self.certificate.clone())],
                PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(self.private_key.clone())),
            )?;
        config.max_early_data_size = 0;
        config.send_half_rtt_data = false;
        config.send_tls13_tickets = 0;
        Ok(Arc::new(config))
    }

    fn load(certificate_path: &Path, private_key_path: &Path) -> Result<Self> {
        validate_private_file(certificate_path)?;
        validate_private_file(private_key_path)?;
        let identity = Self {
            certificate: std::fs::read(certificate_path)?,
            private_key: std::fs::read(private_key_path)?,
        };
        identity.server_config()?;
        Ok(identity)
    }

    fn create(certificate_path: &Path, private_key_path: &Path) -> Result<Self> {
        let generated = rcgen::generate_simple_self_signed(vec!["codewide-relay".to_owned()])?;
        let identity = Self {
            certificate: generated.cert.der().to_vec(),
            private_key: generated.signing_key.serialize_der(),
        };
        create_private_file(private_key_path, &identity.private_key)?;
        if let Err(error) = create_private_file(certificate_path, &identity.certificate) {
            let _ = std::fs::remove_file(private_key_path);
            return Err(error);
        }
        identity.server_config()?;
        Ok(identity)
    }
}

/// Creates a TLS 1.3 client that accepts only the exact pinned Relay certificate.
/// # Errors
/// Rejects malformed pins and unsupported TLS configuration.
pub fn pinned_client_config(pin: &str) -> Result<Arc<ClientConfig>> {
    let expected = decode_pin(pin)?;
    let provider = rustls::crypto::ring::default_provider();
    let algorithms = provider.signature_verification_algorithms;
    let verifier = Arc::new(PinnedCertificateVerifier {
        expected,
        algorithms,
    });
    let mut config = ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    config.enable_early_data = false;
    config.resumption = Resumption::disabled();
    Ok(Arc::new(config))
}

#[derive(Debug)]
struct PinnedCertificateVerifier {
    expected: [u8; 32],
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for PinnedCertificateVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> std::result::Result<rustls::client::danger::ServerCertVerified, TlsError> {
        let actual = digest(end_entity.as_ref());
        if bool::from(actual.ct_eq(&self.expected)) {
            Ok(rustls::client::danger::ServerCertVerified::assertion())
        } else {
            Err(TlsError::InvalidCertificate(
                CertificateError::ApplicationVerificationFailure,
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(message, certificate, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> std::result::Result<rustls::client::danger::HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(message, certificate, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn digest(certificate: &[u8]) -> [u8; 32] {
    Sha256::digest(certificate).into()
}

fn encode_pin(pin: [u8; 32]) -> String {
    format!("{PIN_PREFIX}{}", STANDARD.encode(pin))
}

fn decode_pin(value: &str) -> Result<[u8; 32]> {
    let encoded = value.strip_prefix(PIN_PREFIX).ok_or_else(denied)?;
    let decoded = STANDARD.decode(encoded).map_err(|_| denied())?;
    decoded.try_into().map_err(|_| denied())
}

fn validate_private_file(path: &Path) -> Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.permissions().mode() & 0o077 != 0 {
        return Err(std::io::Error::other("relay TLS identity file must be private (0600)").into());
    }
    Ok(())
}

fn create_private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_durable_private_and_pinnable() -> Result<()> {
        let directory = tempfile::tempdir()?;
        let first = RelayTlsIdentity::load_or_create(directory.path())?;
        let pin = first.pin();
        assert!(pinned_client_config(&pin).is_ok());
        assert_eq!(
            RelayTlsIdentity::load_or_create(directory.path())?.pin(),
            pin
        );
        assert_eq!(
            std::fs::metadata(directory.path().join(CERT_FILE))?
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert_eq!(
            std::fs::metadata(directory.path().join(KEY_FILE))?
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        Ok(())
    }

    #[test]
    fn malformed_pin_is_rejected() {
        assert!(pinned_client_config("sha256/not-a-pin").is_err());
        assert!(pinned_client_config("not-sha256/value").is_err());
    }
}
