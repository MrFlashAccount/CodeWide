//! Blind reverse transport. No Companion API, device authority, or plaintext lives here.
pub mod adapter;
pub mod auth;
pub mod pairing;
pub mod registry;
pub mod server;
pub mod transport_tls;
mod wire;

pub type Error = Box<dyn std::error::Error + Send + Sync>;
pub type Result<T> = std::result::Result<T, Error>;

fn denied() -> Error {
    std::io::Error::new(
        std::io::ErrorKind::PermissionDenied,
        "relay request rejected",
    )
    .into()
}
