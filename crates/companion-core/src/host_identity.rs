use std::fmt;

const FALLBACK_HOST_DISPLAY_NAME: &str = "CodeWide host";
const MAX_HOST_DISPLAY_NAME_UTF16_UNITS: usize = 80;

/// A user-facing host name that every pairing client can accept.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HostDisplayName(String);

impl HostDisplayName {
    /// Validates a platform-provided computer name against the shared pairing contract.
    ///
    /// # Errors
    /// Returns an error for an empty name or one exceeding the client-visible bound.
    pub fn new(value: impl Into<String>) -> Result<Self, HostDisplayNameError> {
        let value = value.into();
        let value = value.trim();
        if value.is_empty() {
            return Err(HostDisplayNameError::Empty);
        }
        if value.encode_utf16().count() > MAX_HOST_DISPLAY_NAME_UTF16_UNITS {
            return Err(HostDisplayNameError::TooLong);
        }
        Ok(Self(value.to_owned()))
    }

    /// Reads the operating system hostname, with a stable fallback when unavailable.
    #[must_use]
    pub fn system() -> Self {
        system_hostname()
            .and_then(|name| Self::new(name).ok())
            .unwrap_or_else(|| Self(FALLBACK_HOST_DISPLAY_NAME.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for HostDisplayName {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum HostDisplayNameError {
    #[error("host display name must not be empty")]
    Empty,
    #[error("host display name exceeds 80 UTF-16 code units")]
    TooLong,
}

fn system_hostname() -> Option<String> {
    let name = nix::unistd::gethostname()
        .ok()?
        .to_string_lossy()
        .into_owned();
    (!name.trim().is_empty()).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_the_client_visible_name_contract() -> Result<(), HostDisplayNameError> {
        assert_eq!(
            HostDisplayName::new("  Sergey's MacBook Pro  ")?.as_str(),
            "Sergey's MacBook Pro"
        );
        assert_eq!(HostDisplayName::new("  "), Err(HostDisplayNameError::Empty));
        assert_eq!(
            HostDisplayName::new("🖥️".repeat(27)),
            Err(HostDisplayNameError::TooLong)
        );
        Ok(())
    }
}
