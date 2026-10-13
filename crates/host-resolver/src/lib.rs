//! Resolves outbound host names the way the host's own tools do.
//!
//! The Linux products are static musl binaries. musl's resolver sends every
//! query to all `resolv.conf` nameservers at once and keeps the first answer.
//! On an IPv6-only host whose nameservers disagree about DNS64, the fastest one
//! may answer AAAA with no data, leaving only unreachable IPv4 addresses. On
//! Linux this crate therefore asks the host's NSS resolver through
//! `getent ahosts`, which honors nameserver order and address configuration
//! like curl and package managers, and falls back to the built-in resolver
//! only when `getent` is not installed. Other platforms use the system
//! resolver through `tokio::net::lookup_host` and never spawn a process.
//!
//! Every successful resolution is non-empty, deduplicated and keeps the
//! resolver's preference order. IP literals, bare or bracketed, are returned
//! without any lookup.

#[cfg(any(target_os = "linux", test))]
mod nss;

use std::{
    collections::HashSet,
    io,
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use tokio::{net::TcpStream, time::Instant};

/// Resolves `host` to its addresses in the host resolver's preference order.
///
/// # Errors
///
/// Returns `InvalidInput` for an empty host or one starting with `-`, and
/// `NotFound` when the name does not resolve to any address. Process-spawn
/// and system-resolver failures are propagated.
pub async fn resolve(host: &str) -> io::Result<Vec<IpAddr>> {
    if let Some(address) = ip_literal(host) {
        return Ok(vec![address]);
    }
    // A URL host never starts with '-'; refuse anything getent could read as an option.
    if host.is_empty() || host.starts_with('-') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid host name",
        ));
    }
    let addresses = lookup(host).await?;
    if addresses.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "host name has no addresses",
        ));
    }
    Ok(addresses)
}

/// Opens a TCP connection to `host:port`, trying resolved addresses in order.
///
/// Resolution and all attempts share `timeout`. Each attempt receives an equal
/// share of the time left, so one silently dropped address cannot consume the
/// budget of the addresses after it.
///
/// # Errors
///
/// Returns the resolution error, `TimedOut` when the budget is exhausted, or
/// the error of the last failed attempt.
pub async fn connect(host: &str, port: u16, timeout: Duration) -> io::Result<TcpStream> {
    let deadline = Instant::now() + timeout;
    let addresses = tokio::time::timeout_at(deadline, resolve(host))
        .await
        .map_err(|_| timed_out())??;
    connect_any(
        addresses
            .into_iter()
            .map(|address| SocketAddr::new(address, port)),
        deadline,
    )
    .await
}

/// reqwest resolver backed by [`resolve`].
#[derive(Clone, Copy, Debug, Default)]
pub struct HostResolver;

impl HostResolver {
    /// Shared handle in the form `reqwest::ClientBuilder::dns_resolver` takes.
    #[must_use]
    pub fn shared() -> Arc<Self> {
        Arc::new(Self)
    }
}

impl Resolve for HostResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let addresses = resolve(&host).await?;
            // reqwest replaces the port with the URL's port.
            let addrs: Addrs = Box::new(
                addresses
                    .into_iter()
                    .map(|address| SocketAddr::new(address, 0)),
            );
            Ok(addrs)
        })
    }
}

fn ip_literal(host: &str) -> Option<IpAddr> {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'));
    match unbracketed {
        Some(inner) => inner.parse::<std::net::Ipv6Addr>().ok().map(IpAddr::V6),
        None => host.parse().ok(),
    }
}

#[cfg(target_os = "linux")]
async fn lookup(host: &str) -> io::Result<Vec<IpAddr>> {
    match nss::getent_ahosts(host).await? {
        Some(addresses) => Ok(addresses),
        // Hosts without glibc's getent keep the built-in resolver.
        None => system_lookup(host).await,
    }
}

#[cfg(not(target_os = "linux"))]
async fn lookup(host: &str) -> io::Result<Vec<IpAddr>> {
    system_lookup(host).await
}

async fn system_lookup(host: &str) -> io::Result<Vec<IpAddr>> {
    let mut seen = HashSet::new();
    Ok(tokio::net::lookup_host((host, 0))
        .await?
        .map(|address| address.ip())
        .filter(|address| seen.insert(*address))
        .collect())
}

async fn connect_any(
    addresses: impl ExactSizeIterator<Item = SocketAddr>,
    deadline: Instant,
) -> io::Result<TcpStream> {
    let mut remaining = addresses.len();
    let mut last_error = None;
    for address in addresses {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        // `remaining` is at least 1 inside the loop and counts down per attempt.
        let share = left / u32::try_from(remaining).unwrap_or(u32::MAX);
        remaining -= 1;
        match tokio::time::timeout(share, TcpStream::connect(address)).await {
            Ok(Ok(stream)) => return Ok(stream),
            Ok(Err(error)) => last_error = Some(error),
            Err(_) => last_error = Some(timed_out()),
        }
    }
    Err(last_error.unwrap_or_else(timed_out))
}

fn timed_out() -> io::Error {
    io::Error::new(io::ErrorKind::TimedOut, "connection timed out")
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::{net::IpAddr, time::Duration};

    use tokio::{net::TcpListener, time::Instant};

    use super::{connect, connect_any, resolve};

    #[tokio::test]
    async fn ip_literals_resolve_without_a_lookup() {
        for (host, expected) in [
            ("192.0.2.10", "192.0.2.10"),
            ("2001:db8::1", "2001:db8::1"),
            ("[2001:db8::1]", "2001:db8::1"),
        ] {
            let expected: IpAddr = expected.parse().expect("test address");
            assert_eq!(resolve(host).await.expect("literal"), vec![expected]);
        }
    }

    #[tokio::test]
    async fn refuses_names_that_could_be_read_as_options() {
        for host in ["", "-s", "--help"] {
            let error = resolve(host).await.expect_err("invalid host");
            assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        }
    }

    #[tokio::test]
    async fn connect_moves_to_the_next_address_when_one_fails() {
        let refused = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let refused_address = refused.local_addr().expect("address");
        drop(refused);
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let live_address = listener.local_addr().expect("address");

        let stream = connect_any(
            [refused_address, live_address].into_iter(),
            Instant::now() + Duration::from_secs(5),
        )
        .await
        .expect("second address connects");
        assert_eq!(stream.peer_addr().expect("peer"), live_address);
    }

    #[tokio::test]
    async fn connect_reports_the_last_failure_when_every_address_fails() {
        let refused = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let port = refused.local_addr().expect("address").port();
        drop(refused);

        let error = connect("127.0.0.1", port, Duration::from_secs(5))
            .await
            .expect_err("nothing listens");
        assert_eq!(error.kind(), std::io::ErrorKind::ConnectionRefused);
    }
}
