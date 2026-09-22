use std::{
    future::Future,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};

use axum_server::tls_rustls::RustlsConfig;
use base64::{Engine as _, engine::general_purpose};
use http::Request;
use rustls::{
    CertificateError, DigitallySignedStruct, DistinguishedName, Error, ServerConfig,
    SignatureScheme,
    client::danger::HandshakeSignatureValid,
    crypto::{WebPkiSupportedAlgorithms, verify_tls12_signature, verify_tls13_signature},
    pki_types::{CertificateDer, PrivateKeyDer, UnixTime},
    server::danger::{ClientCertVerified, ClientCertVerifier},
};
use sha2::Digest as _;
use tokio_rustls::server::TlsStream;
use tower_service::Service;
use x509_parser::{parse_x509_certificate, time::ASN1Time};

use crate::{auth::TrustedClientSpki, identity::CompanionIdentity};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeviceTlsConnectInfo {
    pub device_id: String,
}

/// Builds the pairing-only TLS listener. Pairing proves possession in the
/// signed request because an unregistered device cannot yet pass mTLS.
///
/// # Errors
///
/// Returns an error when the TLS 1.3 configuration or server identity is invalid.
pub fn bootstrap_config(identity: &CompanionIdentity) -> Result<RustlsConfig, rustls::Error> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let builder = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])?;
    finish_server_config(builder.with_no_client_auth(), identity).map(RustlsConfig::from_config)
}

/// Builds a TLS 1.3 server that accepts only a certificate whose SPKI is in
/// the live device registry. TLS `CertificateVerify` then proves possession of
/// the corresponding non-exportable Android Keystore private key.
///
/// # Errors
///
/// Returns an error when the TLS 1.3 configuration or server identity is invalid.
pub fn device_bound_config(
    identity: &CompanionIdentity,
    trusted: TrustedClientSpki,
) -> Result<Arc<ServerConfig>, rustls::Error> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let algorithms = provider.signature_verification_algorithms;
    let verifier = Arc::new(RegisteredDeviceVerifier {
        trusted,
        algorithms,
        root_hints: Vec::new(),
    });
    let builder = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])?;
    finish_server_config(builder.with_client_cert_verifier(verifier), identity)
}

fn finish_server_config(
    builder: rustls::ConfigBuilder<ServerConfig, rustls::server::WantsServerCert>,
    identity: &CompanionIdentity,
) -> Result<Arc<ServerConfig>, rustls::Error> {
    let certificates = vec![CertificateDer::from(identity.certificate_der().to_vec())];
    let private_key = PrivateKeyDer::try_from(identity.private_key_der().to_vec())
        .map_err(|error| Error::General(error.to_string()))?;
    let mut config = builder.with_single_cert(certificates, private_key)?;
    // Every new tunnel must re-check the live device registry. TLS resumption
    // would otherwise bypass certificate verification after revocation.
    config.session_storage = Arc::new(rustls::server::NoServerSessionStorage {});
    config.send_tls13_tickets = 0;
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Ok(Arc::new(config))
}

#[derive(Clone)]
pub struct DeviceTlsAcceptor {
    tls: tokio_rustls::TlsAcceptor,
}

impl DeviceTlsAcceptor {
    #[must_use]
    pub fn new(config: Arc<ServerConfig>) -> Self {
        Self {
            tls: tokio_rustls::TlsAcceptor::from(config),
        }
    }
}

impl<S> axum_server::accept::Accept<tokio::net::TcpStream, S> for DeviceTlsAcceptor
where
    S: Send + 'static,
{
    type Stream = TlsStream<tokio::net::TcpStream>;
    type Service = DeviceIdentityService<S>;
    type Future = Pin<
        Box<dyn Future<Output = std::io::Result<(Self::Stream, Self::Service)>> + Send + 'static>,
    >;

    fn accept(&self, stream: tokio::net::TcpStream, service: S) -> Self::Future {
        let tls = self.tls.clone();
        Box::pin(async move {
            let stream = tokio::time::timeout(Duration::from_secs(10), tls.accept(stream))
                .await
                .map_err(|_| {
                    std::io::Error::new(std::io::ErrorKind::TimedOut, "TLS handshake timed out")
                })??;
            let identity = device_connect_info(&stream)?;
            Ok((
                stream,
                DeviceIdentityService {
                    inner: service,
                    identity,
                },
            ))
        })
    }
}

#[derive(Clone)]
pub struct DeviceIdentityService<S> {
    inner: S,
    identity: DeviceTlsConnectInfo,
}

impl<S, B> Service<Request<B>> for DeviceIdentityService<S>
where
    S: Service<Request<B>>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = S::Future;

    fn poll_ready(&mut self, context: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(context)
    }

    fn call(&mut self, mut request: Request<B>) -> Self::Future {
        request.extensions_mut().insert(self.identity.clone());
        self.inner.call(request)
    }
}

fn device_connect_info(
    stream: &TlsStream<tokio::net::TcpStream>,
) -> Result<DeviceTlsConnectInfo, std::io::Error> {
    let certificate = stream
        .get_ref()
        .1
        .peer_certificates()
        .and_then(|certificates| certificates.first())
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "client certificate missing",
            )
        })?;
    let spki = certificate_spki(certificate)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
    Ok(DeviceTlsConnectInfo {
        device_id: format!("device-{}", hex::encode(sha2::Sha256::digest(&spki))),
    })
}

#[derive(Debug)]
struct RegisteredDeviceVerifier {
    trusted: TrustedClientSpki,
    algorithms: WebPkiSupportedAlgorithms,
    root_hints: Vec<DistinguishedName>,
}

impl ClientCertVerifier for RegisteredDeviceVerifier {
    fn root_hint_subjects(&self) -> &[DistinguishedName] {
        &self.root_hints
    }

    fn verify_client_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        now: UnixTime,
    ) -> Result<ClientCertVerified, Error> {
        if !intermediates.is_empty() {
            return Err(Error::InvalidCertificate(CertificateError::UnknownIssuer));
        }
        let spki = certificate_spki(end_entity)?;
        let (_, certificate) = parse_x509_certificate(end_entity.as_ref())
            .map_err(|_| Error::InvalidCertificate(CertificateError::BadEncoding))?;
        let now = i64::try_from(now.as_secs())
            .ok()
            .and_then(|seconds| ASN1Time::from_timestamp(seconds).ok())
            .ok_or_else(|| Error::InvalidCertificate(CertificateError::BadEncoding))?;
        if !certificate.validity().is_valid_at(now) {
            return Err(Error::InvalidCertificate(CertificateError::Expired));
        }
        let public_key_spki = general_purpose::STANDARD.encode(spki);
        if !self.trusted.contains(&public_key_spki) {
            return Err(Error::InvalidCertificate(CertificateError::UnknownIssuer));
        }
        Ok(ClientCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls12_signature(message, certificate, signature, &self.algorithms)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        certificate: &CertificateDer<'_>,
        signature: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, Error> {
        verify_tls13_signature(message, certificate, signature, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

fn certificate_spki(certificate: &CertificateDer<'_>) -> Result<Vec<u8>, Error> {
    let (remaining, certificate) = parse_x509_certificate(certificate.as_ref())
        .map_err(|_| Error::InvalidCertificate(CertificateError::BadEncoding))?;
    if !remaining.is_empty() {
        return Err(Error::InvalidCertificate(CertificateError::BadEncoding));
    }
    Ok(certificate.public_key().raw.to_vec())
}
