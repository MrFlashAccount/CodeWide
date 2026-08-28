//! Validated scalar wire types owned by Sync V2.

use std::fmt;

use serde::{Deserialize, Deserializer, Serialize, de};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Id(String);

impl Id {
    /// Constructs a non-empty identifier bounded to 256 UTF-8 bytes.
    ///
    /// # Errors
    ///
    /// Returns `ScalarError::Id` when the value is empty or exceeds the byte limit.
    pub fn new(value: impl Into<String>) -> Result<Self, ScalarError> {
        let value = value.into();
        if value.is_empty() || value.len() > 256 {
            return Err(ScalarError::Id);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_generated(value: String) -> Self {
        debug_assert!(!value.is_empty() && value.len() <= 256);
        Self(value)
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct OperationId(String);

impl OperationId {
    /// Constructs a visible-ASCII idempotency identifier.
    ///
    /// # Errors
    ///
    /// Returns `ScalarError::OperationId` when the value violates the wire bounds.
    pub fn new(value: impl Into<String>) -> Result<Self, ScalarError> {
        let value = value.into();
        if value.is_empty()
            || value.len() > 128
            || !value.bytes().all(|byte| (b'!'..=b'~').contains(&byte))
        {
            return Err(ScalarError::OperationId);
        }
        Ok(Self(value))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for OperationId {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub struct U64(u64);

impl U64 {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }
}

impl Serialize for U64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for U64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        if value != "0" && value.starts_with('0') {
            return Err(de::Error::custom(ScalarError::U64));
        }
        value
            .parse::<u64>()
            .map(Self)
            .map_err(|_| de::Error::custom(ScalarError::U64))
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Timestamp(String);

impl Timestamp {
    /// Constructs a UTC RFC 3339 timestamp ending in `Z`.
    ///
    /// # Errors
    ///
    /// Returns `ScalarError::Timestamp` for a non-canonical timestamp.
    pub fn new(value: impl Into<String>) -> Result<Self, ScalarError> {
        let value = value.into();
        if !value.ends_with('Z') || OffsetDateTime::parse(&value, &Rfc3339).is_err() {
            return Err(ScalarError::Timestamp);
        }
        Ok(Self(value))
    }

    #[allow(clippy::expect_used, clippy::missing_panics_doc)]
    #[must_use]
    pub fn now() -> Self {
        let value = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .expect("RFC 3339 formatting cannot fail");
        Self(value)
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl<'de> Deserialize<'de> for Timestamp {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScalarError {
    Id,
    OperationId,
    U64,
    Timestamp,
}

impl fmt::Display for ScalarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Id => "id must be 1-256 UTF-8 bytes",
            Self::OperationId => "operation id must be 1-128 visible ASCII bytes",
            Self::U64 => "u64 must be a canonical unsigned decimal string",
            Self::Timestamp => "timestamp must be RFC 3339 UTC with a Z suffix",
        })
    }
}

impl std::error::Error for ScalarError {}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn id_limit_is_utf8_bytes_not_unicode_scalar_count() {
        assert!(Id::new("a".repeat(256)).is_ok());
        assert!(Id::new("é".repeat(128)).is_ok());
        assert_eq!(Id::new("é".repeat(129)), Err(ScalarError::Id));
    }

    #[test]
    fn u64_wire_value_is_a_canonical_decimal_string() {
        assert_eq!(
            serde_json::to_string(&U64::new(u64::MAX)).unwrap(),
            format!("\"{}\"", u64::MAX)
        );
        assert!(serde_json::from_str::<U64>("\"01\"").is_err());
        assert!(serde_json::from_str::<U64>("1").is_err());
    }
}
