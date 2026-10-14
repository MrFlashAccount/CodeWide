//! The standard proxy variables of the user's Claude settings, forwarded to
//! every `claude` process without loading the rest of those settings
//! (`host/src/claude/sdkProxyEnvironment.ts`).
//!
//! The host asked the Agent SDK's in-process settings engine
//! (`resolveSettings({settingSources: ["user"]})`) for the effective `env`
//! of the user and managed (policy) tiers. The `claude` command line has no
//! equivalent that prints resolved settings, so this reads the user tier
//! itself: `settings.json` in `$CLAUDE_CONFIG_DIR`, else `~/.claude`. The
//! managed tier needs no forwarding: `claude` loads it at every start,
//! whatever `--setting-sources` says, and it takes precedence over the
//! process environment, so the effective values a session sees are the
//! same. Only the variables below cross; every other entry, credentials
//! included, is never read into the result.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
};

use serde_json::Value;

/// A proxy variable `CodeWide` may forward from Claude's user settings.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProxyVariable {
    /// `HTTP_PROXY`.
    HttpProxy,
    /// `HTTPS_PROXY`.
    HttpsProxy,
    /// `NO_PROXY`.
    NoProxy,
    /// `http_proxy`.
    HttpProxyLower,
    /// `https_proxy`.
    HttpsProxyLower,
    /// `no_proxy`.
    NoProxyLower,
}

impl ProxyVariable {
    /// Every forwarded variable.
    pub const ALL: [Self; 6] = [
        Self::HttpProxy,
        Self::HttpsProxy,
        Self::NoProxy,
        Self::HttpProxyLower,
        Self::HttpsProxyLower,
        Self::NoProxyLower,
    ];

    /// The environment variable's name.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::HttpProxy => "HTTP_PROXY",
            Self::HttpsProxy => "HTTPS_PROXY",
            Self::NoProxy => "NO_PROXY",
            Self::HttpProxyLower => "http_proxy",
            Self::HttpsProxyLower => "https_proxy",
            Self::NoProxyLower => "no_proxy",
        }
    }
}

/// The proxy variables the user's Claude settings set, in
/// [`ProxyVariable::ALL`] order; empty when they set none.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProxyEnvironment {
    variables: Vec<(ProxyVariable, String)>,
}

impl ProxyEnvironment {
    /// The configured variables and their values.
    #[must_use]
    pub fn variables(&self) -> &[(ProxyVariable, String)] {
        &self.variables
    }

    /// The variables as process environment entries, to add after the
    /// companion's own environment.
    #[must_use]
    pub fn environment(&self) -> Vec<(OsString, OsString)> {
        self.variables
            .iter()
            .map(|(variable, value)| (variable.name().into(), value.into()))
            .collect()
    }
}

/// Why the proxy environment could not be resolved. Starting `claude`
/// without it could bypass the user's required network configuration, so
/// the caller must not fall back to an empty one.
#[derive(Debug, thiserror::Error)]
pub enum ProxyEnvironmentError {
    #[error("Claude user settings could not be read: {0}")]
    Read(#[from] std::io::Error),
    #[error("Claude user settings are not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Claude user settings must be an object")]
    SettingsNotObject,
    #[error("Claude user settings environment must be an object")]
    EnvironmentNotObject,
    #[error("Claude proxy environment values must be strings")]
    ValueNotString,
}

/// Claude's user settings file: `settings.json` in `claude_config_dir`
/// (`CLAUDE_CONFIG_DIR`), else in `<home>/.claude`.
#[must_use]
pub fn user_settings_path(claude_config_dir: Option<&Path>, home: &Path) -> PathBuf {
    claude_config_dir
        .map_or_else(|| home.join(".claude"), Path::to_path_buf)
        .join("settings.json")
}

/// The standard proxy variables of a settings object's `env`.
///
/// A missing `env` means no overrides. An invalid selected value is an
/// error; unrelated entries are ignored whatever their values.
///
/// # Errors
///
/// Returns a settings value or `env` that is not an object, or a selected
/// variable whose value is not a string.
pub fn proxy_environment_from_settings(
    settings: &Value,
) -> Result<ProxyEnvironment, ProxyEnvironmentError> {
    let settings = settings
        .as_object()
        .ok_or(ProxyEnvironmentError::SettingsNotObject)?;
    let Some(env) = settings.get("env") else {
        return Ok(ProxyEnvironment::default());
    };
    let env = env
        .as_object()
        .ok_or(ProxyEnvironmentError::EnvironmentNotObject)?;
    let variables = ProxyVariable::ALL
        .into_iter()
        .filter_map(|variable| env.get(variable.name()).map(|value| (variable, value)))
        .map(|(variable, value)| match value {
            Value::String(value) => Ok((variable, value.clone())),
            _ => Err(ProxyEnvironmentError::ValueNotString),
        })
        .collect::<Result<_, _>>()?;
    Ok(ProxyEnvironment { variables })
}

/// Reads the proxy environment of the user settings at `path` (once, at
/// start: a small file); a missing file sets none.
///
/// # Errors
///
/// Returns an unreadable or invalid file (see
/// [`proxy_environment_from_settings`]).
pub fn read_user_proxy_environment(path: &Path) -> Result<ProxyEnvironment, ProxyEnvironmentError> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProxyEnvironment::default());
        }
        Err(error) => return Err(error.into()),
    };
    proxy_environment_from_settings(&serde_json::from_str(&text)?)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn names(environment: &ProxyEnvironment) -> Vec<(&'static str, &str)> {
        environment
            .variables()
            .iter()
            .map(|(variable, value)| (variable.name(), value.as_str()))
            .collect()
    }

    #[tokio::test]
    async fn only_standard_proxy_variables_of_the_user_settings_cross() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let path = user_settings_path(Some(directory.path()), Path::new("/nonexistent"));
        std::fs::write(
            &path,
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "must-not-cross",
                    "HTTPS_PROXY": "http://proxy.example",
                    "HTTP_PROXY": "http://proxy.example",
                    "NO_PROXY": "localhost",
                    "UNRELATED": "must-not-cross",
                    "http_proxy": "http://lower-proxy.example",
                    "https_proxy": "http://lower-proxy.example",
                    "no_proxy": "localhost",
                },
                "hooks": {"Stop": []},
            })
            .to_string(),
        )
        .unwrap_or_else(|error| panic!("{error}"));
        let environment =
            read_user_proxy_environment(&path).unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            names(&environment),
            [
                ("HTTP_PROXY", "http://proxy.example"),
                ("HTTPS_PROXY", "http://proxy.example"),
                ("NO_PROXY", "localhost"),
                ("http_proxy", "http://lower-proxy.example"),
                ("https_proxy", "http://lower-proxy.example"),
                ("no_proxy", "localhost"),
            ]
        );
        assert_eq!(
            environment.environment().first(),
            Some(&("HTTP_PROXY".into(), "http://proxy.example".into()))
        );
    }

    #[tokio::test]
    async fn missing_settings_or_environment_set_no_overrides() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let missing = read_user_proxy_environment(&directory.path().join("settings.json"));
        assert_eq!(missing.ok(), Some(ProxyEnvironment::default()));
        assert_eq!(
            proxy_environment_from_settings(&json!({})).ok(),
            Some(ProxyEnvironment::default())
        );
        let unreadable = read_user_proxy_environment(directory.path());
        assert!(matches!(unreadable, Err(ProxyEnvironmentError::Read(_))));
    }

    #[test]
    fn an_unexpected_selected_shape_is_rejected() {
        for settings in [
            json!(null),
            json!([]),
            json!({"env": null}),
            json!({"env": []}),
            json!({"env": "HTTP_PROXY=x"}),
            json!({"env": {"HTTP_PROXY": 42}}),
            json!({"env": {"no_proxy": false}}),
        ] {
            assert!(
                proxy_environment_from_settings(&settings).is_err(),
                "{settings} was accepted"
            );
        }
    }

    #[test]
    fn unrelated_entries_are_ignored_even_when_invalid() {
        assert_eq!(
            proxy_environment_from_settings(
                &json!({"env": {"ANTHROPIC_AUTH_TOKEN": 42, "UNRELATED": null}})
            )
            .ok(),
            Some(ProxyEnvironment::default())
        );
    }

    #[test]
    fn the_user_settings_live_in_the_claude_config_directory_else_home() {
        assert_eq!(
            user_settings_path(Some(Path::new("/config")), Path::new("/home/me")),
            Path::new("/config/settings.json")
        );
        assert_eq!(
            user_settings_path(None, Path::new("/home/me")),
            Path::new("/home/me/.claude/settings.json")
        );
    }
}
