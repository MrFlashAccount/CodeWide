use std::{io::ErrorKind, path::Path};

use reqwest::{ClientBuilder, NoProxy, Proxy};

const HTTP_PROXY: &str = "HTTP_PROXY";
const HTTPS_PROXY: &str = "HTTPS_PROXY";
const NO_PROXY: &str = "NO_PROXY";

#[derive(Clone, Default)]
pub struct HttpProxyConfig {
    http: Option<String>,
    https: Option<String>,
    no_proxy: Option<String>,
}

impl HttpProxyConfig {
    /// Reads standard proxy variables from a dotenv file.
    ///
    /// A missing file means no explicit overrides. Other parse and I/O
    /// failures are returned without exposing any configured value.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read or parsed.
    pub fn from_dotenv(path: &Path) -> Result<Self, HttpProxyConfigError> {
        let entries = match dotenvy::from_path_iter(path) {
            Ok(entries) => entries,
            Err(dotenvy::Error::Io(error)) if error.kind() == ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(_) => return Err(HttpProxyConfigError::Unreadable),
        };

        let mut environment = Self::default();
        for entry in entries {
            let (name, value) = entry.map_err(|_| HttpProxyConfigError::Invalid)?;
            environment.set_if_supported(&name, value);
        }
        Ok(environment)
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

    fn set_if_supported(&mut self, name: &str, value: String) {
        let slot = match name {
            HTTP_PROXY => &mut self.http,
            HTTPS_PROXY => &mut self.https,
            NO_PROXY => &mut self.no_proxy,
            "http_proxy" if self.http.is_none() => &mut self.http,
            "https_proxy" if self.https.is_none() => &mut self.https,
            "no_proxy" if self.no_proxy.is_none() => &mut self.no_proxy,
            _ => return,
        };
        *slot = Some(value);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum HttpProxyConfigError {
    #[error("HTTP proxy environment is unreadable")]
    Unreadable,
    #[error("HTTP proxy environment is invalid")]
    Invalid,
}

#[cfg(test)]
mod tests {
    use std::{error::Error, fs, io};

    use super::*;
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        time::{Duration, timeout},
    };

    type TestResult<T = ()> = Result<T, Box<dyn Error + Send + Sync>>;

    #[test]
    fn loads_only_standard_proxy_variables_with_uppercase_precedence() -> TestResult {
        let root = tempfile::tempdir()?;
        fs::write(
            root.path().join(".env"),
            concat!(
                "HTTP_PROXY=http://upper-http.example:8080\n",
                "http_proxy=http://lower-http.example:8080\n",
                "https_proxy='http://lower-https.example:8080'\n",
                "NO_PROXY=localhost,.example.test\n",
                "OPENAI_API_KEY=must-not-be-loaded\n",
            ),
        )?;

        let environment = HttpProxyConfig::from_dotenv(&root.path().join(".env"))?;

        assert_eq!(
            environment.http.as_deref(),
            Some("http://upper-http.example:8080")
        );
        assert_eq!(
            environment.https.as_deref(),
            Some("http://lower-https.example:8080")
        );
        assert_eq!(
            environment.no_proxy.as_deref(),
            Some("localhost,.example.test")
        );
        Ok(())
    }

    #[test]
    fn missing_environment_keeps_reqwest_system_proxy_behavior() -> TestResult {
        let root = tempfile::tempdir()?;

        let environment = HttpProxyConfig::from_dotenv(&root.path().join(".env"))?;

        assert!(!environment.http_is_configured());
        assert!(!environment.https_is_configured());
        assert!(!environment.no_proxy_is_configured());
        environment.apply(reqwest::Client::builder())?.build()?;
        Ok(())
    }

    #[test]
    fn rejects_invalid_proxy_urls_without_exposing_values() -> TestResult {
        let root = tempfile::tempdir()?;
        fs::write(root.path().join(".env"), "HTTPS_PROXY=http://[::1\n")?;
        let environment = HttpProxyConfig::from_dotenv(&root.path().join(".env"))?;

        let Err(error) = environment.apply(reqwest::Client::builder()) else {
            return Err(io::Error::other("invalid proxy URL was accepted").into());
        };

        assert_eq!(error.to_string(), "HTTP proxy environment is invalid");
        Ok(())
    }

    #[tokio::test]
    async fn routes_https_requests_through_the_configured_proxy() -> TestResult {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let proxy_address = listener.local_addr()?;
        let root = tempfile::tempdir()?;
        fs::write(
            root.path().join(".env"),
            format!("HTTPS_PROXY=http://{proxy_address}\n"),
        )?;
        let environment = HttpProxyConfig::from_dotenv(&root.path().join(".env"))?;
        let client = environment.apply(reqwest::Client::builder())?.build()?;
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
