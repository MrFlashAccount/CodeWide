//! Bounded random bearer tokens used only by the relay pairing and carrier protocols.
use crate::{Result, denied};
use rand::RngCore;
use subtle::ConstantTimeEq;

const MIN_TOKEN_BYTES: usize = 32;
const MAX_TOKEN_BYTES: usize = 512;

#[must_use]
pub fn generate() -> String {
    let mut random = [0_u8; 32];
    rand::rng().fill_bytes(&mut random);
    hex::encode(random)
}

/// Validates the bounded token contract.
/// # Errors
/// Rejects short, oversized or whitespace-bearing values.
pub fn validate(value: &str) -> Result<&str> {
    if value.len() < MIN_TOKEN_BYTES
        || value.len() > MAX_TOKEN_BYTES
        || value
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
    {
        return Err(std::io::Error::other("relay token is invalid").into());
    }
    Ok(value)
}

#[must_use]
pub fn digest(value: &str) -> [u8; 32] {
    *blake3::hash(value.as_bytes()).as_bytes()
}

#[must_use]
pub fn digest_hex(value: &str) -> String {
    hex::encode(digest(value))
}

#[must_use]
pub fn matches(expected: &str, actual: &str) -> bool {
    expected.len() == actual.len() && bool::from(expected.as_bytes().ct_eq(actual.as_bytes()))
}

pub(crate) fn bearer(headers: &axum::http::HeaderMap) -> Result<&str> {
    let value = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or_else(denied)?;
    validate(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_tokens_are_bounded_and_compare_in_constant_time() -> Result<()> {
        let first = generate();
        let second = generate();
        validate(&first)?;
        assert!(matches(&first, &first));
        assert!(!matches(&first, &second));
        assert_ne!(digest(&first), digest(&second));
        Ok(())
    }
}
