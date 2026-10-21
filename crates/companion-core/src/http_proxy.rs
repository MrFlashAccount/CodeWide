use std::{
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};

use rand::{TryRngCore, rngs::OsRng};
use reqwest::{ClientBuilder, NoProxy, Proxy};
use serde::{Deserialize, Serialize};

const SETTINGS_FILE_NAME: &str = "http-proxy.json";
const SETTINGS_VERSION: u8 = 1;

/// User-owned HTTP proxy settings for Companion network requests.
///
/// Empty settings preserve reqwest's standard process-environment discovery.
#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpProxySettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_proxy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub https_proxy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub no_proxy: Option<String>,
}

impl HttpProxySettings {
    #[must_use]
    pub fn is_configured(&self) -> bool {
        [&self.http_proxy, &self.https_proxy]
            .into_iter()
            .any(|value| {
                value
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
            })
    }

    fn normalized(mut self) -> Self {
        self.http_proxy = normalized_value(self.http_proxy);
        self.https_proxy = normalized_value(self.https_proxy);
        self.no_proxy = normalized_value(self.no_proxy);
        self
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StoredHttpProxySettings {
    version: u8,
    #[serde(flatten)]
    settings: HttpProxySettings,
}

/// Durable owner of Companion's application-specific HTTP proxy settings.
#[derive(Clone, Debug)]
pub struct HttpProxySettingsStore {
    path: PathBuf,
}

impl HttpProxySettingsStore {
    #[must_use]
    pub fn new(state_directory: &Path) -> Self {
        Self {
            path: state_directory.join(SETTINGS_FILE_NAME),
        }
    }

    /// Loads and validates the saved settings. A missing file means that the
    /// HTTP client should retain its standard process-environment behavior.
    ///
    /// # Errors
    ///
    /// Returns an error when the file is unreadable, malformed, uses an
    /// unsupported version, or contains an invalid proxy configuration.
    pub fn load(&self) -> Result<HttpProxySettings, HttpProxyConfigError> {
        let bytes = match fs::read(&self.path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Ok(HttpProxySettings::default());
            }
            Err(_) => return Err(HttpProxyConfigError::Unreadable),
        };
        let stored: StoredHttpProxySettings =
            serde_json::from_slice(&bytes).map_err(|_| HttpProxyConfigError::Invalid)?;
        if stored.version != SETTINGS_VERSION {
            return Err(HttpProxyConfigError::UnsupportedVersion);
        }
        let settings = stored.settings.normalized();
        HttpProxyConfig::from_settings(&settings)?;
        Ok(settings)
    }

    /// Validates and atomically saves the effective application setting.
    /// Empty settings remove the file and restore process-environment lookup.
    ///
    /// # Errors
    ///
    /// Returns an error when validation or durable storage fails.
    pub fn save(
        &self,
        settings: HttpProxySettings,
    ) -> Result<HttpProxySettings, HttpProxyConfigError> {
        let settings = settings.normalized();
        HttpProxyConfig::from_settings(&settings)?;
        if !settings.is_configured() {
            match fs::remove_file(&self.path) {
                Ok(()) => {}
                Err(error) if error.kind() == ErrorKind::NotFound => {}
                Err(_) => return Err(HttpProxyConfigError::Unreadable),
            }
            return Ok(settings);
        }

        let parent = self.path.parent().ok_or(HttpProxyConfigError::Unreadable)?;
        fs::create_dir_all(parent).map_err(|_| HttpProxyConfigError::Unreadable)?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|_| HttpProxyConfigError::Unreadable)?;
        let mut nonce = [0_u8; 8];
        OsRng
            .try_fill_bytes(&mut nonce)
            .map_err(|_| HttpProxyConfigError::Unreadable)?;
        let temporary =
            self.path
                .with_extension(format!("tmp-{}-{}", std::process::id(), hex::encode(nonce)));
        let write_result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temporary)?;
            serde_json::to_writer_pretty(
                &mut file,
                &StoredHttpProxySettings {
                    version: SETTINGS_VERSION,
                    settings: settings.clone(),
                },
            )?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&temporary, &self.path)?;
            fs::File::open(parent)?.sync_all()?;
            Ok::<(), Box<dyn std::error::Error>>(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(temporary);
            return Err(HttpProxyConfigError::Unreadable);
        }
        Ok(settings)
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

#[derive(Clone, Default)]
pub struct HttpProxyConfig {
    http: Option<String>,
    https: Option<String>,
    no_proxy: Option<String>,
}

impl HttpProxyConfig {
    /// Validates an application setting for use by reqwest.
    ///
    /// # Errors
    ///
    /// Returns an error when a proxy URL is invalid or a bypass list is set
    /// without an application-owned proxy.
    pub fn from_settings(settings: &HttpProxySettings) -> Result<Self, HttpProxyConfigError> {
        if settings.no_proxy.is_some() && !settings.is_configured() {
            return Err(HttpProxyConfigError::Invalid);
        }
        if let Some(url) = &settings.http_proxy {
            Proxy::http(url).map_err(|_| HttpProxyConfigError::Invalid)?;
        }
        if let Some(url) = &settings.https_proxy {
            Proxy::https(url).map_err(|_| HttpProxyConfigError::Invalid)?;
        }
        Ok(Self {
            http: settings.http_proxy.clone(),
            https: settings.https_proxy.clone(),
            no_proxy: settings.no_proxy.clone(),
        })
    }

    pub(crate) fn apply(
        &self,
        mut builder: ClientBuilder,
    ) -> Result<ClientBuilder, HttpProxyConfigError> {
        let no_proxy = self.no_proxy.as_deref().and_then(NoProxy::from_string);
        if let Some(url) = &self.http {
            let proxy = Proxy::http(url)
                .map_err(|_| HttpProxyConfigError::Invalid)?
                .no_proxy(no_proxy.clone());
            builder = builder.proxy(proxy);
        }
        if let Some(url) = &self.https {
            let proxy = Proxy::https(url)
                .map_err(|_| HttpProxyConfigError::Invalid)?
                .no_proxy(no_proxy);
            builder = builder.proxy(proxy);
        }
        Ok(builder)
    }

    pub(crate) fn http_is_configured(&self) -> bool {
        self.http.is_some()
    }

    pub(crate) fn https_is_configured(&self) -> bool {
        self.https.is_some()
    }

    pub(crate) fn no_proxy_is_configured(&self) -> bool {
        self.no_proxy.is_some()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum HttpProxyConfigError {
    #[error("Companion HTTP proxy settings are unreadable")]
    Unreadable,
    #[error("Companion HTTP proxy settings are invalid")]
    Invalid,
    #[error("Companion HTTP proxy settings use an unsupported version")]
    UnsupportedVersion,
}

fn normalized_value(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use std::{error::Error, io};

    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        time::{Duration, timeout},
    };

    type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

    #[test]
    fn missing_settings_keep_reqwest_system_proxy_behavior() -> TestResult {
        let root = tempfile::tempdir()?;
        let store = HttpProxySettingsStore::new(root.path());

        let settings = store.load()?;
        let config = HttpProxyConfig::from_settings(&settings)?;

        assert_eq!(settings, HttpProxySettings::default());
        assert!(!config.http_is_configured());
        assert!(!config.https_is_configured());
        assert!(!config.no_proxy_is_configured());
        config.apply(reqwest::Client::builder())?.build()?;
        Ok(())
    }

    #[test]
    fn saves_normalized_private_application_settings() -> TestResult {
        let root = tempfile::tempdir()?;
        let store = HttpProxySettingsStore::new(root.path());

        let saved = store.save(HttpProxySettings {
            http_proxy: None,
            https_proxy: Some("  http://proxy.example:8080  ".into()),
            no_proxy: Some(" localhost,.example.test ".into()),
        })?;

        assert_eq!(
            saved.https_proxy.as_deref(),
            Some("http://proxy.example:8080")
        );
        assert_eq!(saved.no_proxy.as_deref(), Some("localhost,.example.test"));
        assert_eq!(store.load()?, saved);
        assert_eq!(
            fs::metadata(store.path())?.permissions().mode() & 0o777,
            0o600
        );
        Ok(())
    }

    #[test]
    fn empty_settings_restore_environment_fallback() -> TestResult {
        let root = tempfile::tempdir()?;
        let store = HttpProxySettingsStore::new(root.path());
        store.save(HttpProxySettings {
            https_proxy: Some("http://proxy.example:8080".into()),
            ..HttpProxySettings::default()
        })?;

        let saved = store.save(HttpProxySettings::default())?;

        assert_eq!(saved, HttpProxySettings::default());
        assert!(!store.path().exists());
        Ok(())
    }

    #[test]
    fn rejects_invalid_proxy_urls_without_exposing_values() -> TestResult {
        let settings = HttpProxySettings {
            https_proxy: Some("http://[::1".into()),
            ..HttpProxySettings::default()
        };

        let error = HttpProxyConfig::from_settings(&settings)
            .err()
            .ok_or_else(|| io::Error::other("invalid proxy URL was accepted"))?;

        assert_eq!(
            error.to_string(),
            "Companion HTTP proxy settings are invalid"
        );
        Ok(())
    }

    #[test]
    fn rejects_bypass_list_without_explicit_proxy() {
        let settings = HttpProxySettings {
            no_proxy: Some("localhost".into()),
            ..HttpProxySettings::default()
        };

        assert!(matches!(
            HttpProxyConfig::from_settings(&settings),
            Err(HttpProxyConfigError::Invalid)
        ));
    }

    #[test]
    fn rejects_stored_settings_with_unknown_fields_or_versions() -> TestResult {
        let root = tempfile::tempdir()?;
        let store = HttpProxySettingsStore::new(root.path());

        fs::write(
            store.path(),
            r#"{"version":1,"httpsProxy":"http://proxy.example:8080","socksProxy":"x"}"#,
        )?;
        assert!(matches!(store.load(), Err(HttpProxyConfigError::Invalid)));

        fs::write(
            store.path(),
            r#"{"version":2,"httpsProxy":"http://proxy.example:8080"}"#,
        )?;
        assert!(matches!(
            store.load(),
            Err(HttpProxyConfigError::UnsupportedVersion)
        ));
        Ok(())
    }

    #[test]
    fn rejected_save_keeps_the_previous_settings() -> TestResult {
        let root = tempfile::tempdir()?;
        let store = HttpProxySettingsStore::new(root.path());
        let previous = store.save(HttpProxySettings {
            https_proxy: Some("http://proxy.example:8080".into()),
            ..HttpProxySettings::default()
        })?;

        let rejected = store.save(HttpProxySettings {
            https_proxy: Some("http://[::1".into()),
            ..HttpProxySettings::default()
        });

        assert!(matches!(rejected, Err(HttpProxyConfigError::Invalid)));
        assert_eq!(store.load()?, previous);
        Ok(())
    }

    #[tokio::test]
    async fn bypass_list_sends_matching_hosts_directly() -> TestResult {
        let proxy = TcpListener::bind("127.0.0.1:0").await?;
        let origin = TcpListener::bind("127.0.0.1:0").await?;
        let origin_port = origin.local_addr()?.port();
        let settings = HttpProxySettings {
            http_proxy: Some(format!("http://{}", proxy.local_addr()?)),
            no_proxy: Some("127.0.0.1".into()),
            ..HttpProxySettings::default()
        };
        let client = HttpProxyConfig::from_settings(&settings)?
            .apply(reqwest::Client::builder())?
            .build()?;
        let origin_request = tokio::spawn(async move {
            let (mut socket, _) = origin.accept().await?;
            let mut request = vec![0_u8; 4096];
            let bytes = socket.read(&mut request).await?;
            socket
                .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\n\r\n")
                .await?;
            Ok::<_, Box<dyn Error + Send + Sync>>(String::from_utf8(request[..bytes].to_vec())?)
        });

        let response = timeout(
            Duration::from_secs(2),
            client
                .get(format!("http://127.0.0.1:{origin_port}/probe"))
                .send(),
        )
        .await??;

        assert_eq!(response.status(), reqwest::StatusCode::NO_CONTENT);
        assert!(
            origin_request
                .await??
                .starts_with("GET /probe HTTP/1.1\r\n")
        );
        assert!(
            timeout(Duration::from_millis(100), proxy.accept())
                .await
                .is_err(),
            "bypassed request reached the proxy"
        );
        Ok(())
    }

    #[tokio::test]
    async fn routes_https_requests_through_the_configured_proxy() -> TestResult {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let proxy_address = listener.local_addr()?;
        let settings = HttpProxySettings {
            https_proxy: Some(format!("http://{proxy_address}")),
            ..HttpProxySettings::default()
        };
        let config = HttpProxyConfig::from_settings(&settings)?;
        let client = config.apply(reqwest::Client::builder())?.build()?;
        let proxy_request = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await?;
            let mut request = vec![0_u8; 4096];
            let bytes = socket.read(&mut request).await?;
            socket
                .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                .await?;
            Ok::<_, Box<dyn Error + Send + Sync>>(String::from_utf8(request[..bytes].to_vec())?)
        });

        let response = timeout(
            Duration::from_secs(2),
            client.get("https://dictation.invalid/probe").send(),
        )
        .await?;
        assert!(response.is_err());
        let request = proxy_request.await??;
        assert!(request.starts_with("CONNECT dictation.invalid:443 HTTP/1.1\r\n"));
        Ok(())
    }
}
