//! Resolves release hosts the way the host's own tools do.
//!
//! The static musl resolver sends every query to all `resolv.conf` nameservers
//! at once and keeps the first answer. On an IPv6-only host whose nameservers
//! disagree about DNS64, the fastest one may answer AAAA with no data, leaving
//! only unreachable IPv4 addresses for an IPv4-only origin such as GitHub's
//! release assets. `getent ahosts` uses the host's NSS resolver, which honors
//! nameserver order and address configuration like curl and package managers.

use std::{
    collections::HashSet,
    io,
    net::{IpAddr, SocketAddr},
    process::Stdio,
};

use reqwest::dns::{Addrs, Name, Resolve, Resolving};

/// reqwest resolver backed by the host's NSS configuration.
#[derive(Clone, Copy, Debug, Default)]
pub(super) struct HostResolver;

impl Resolve for HostResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_owned();
        Box::pin(async move {
            let addresses = resolve_host(&host).await?;
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

async fn resolve_host(host: &str) -> io::Result<Vec<IpAddr>> {
    // A URL host never starts with '-'; refuse anything getent could read as an option.
    if host.is_empty() || host.starts_with('-') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid host name",
        ));
    }
    let output = match tokio::process::Command::new("getent")
        .arg("ahosts")
        .arg(host)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
    {
        Ok(output) => output,
        // Hosts without glibc's getent keep the built-in resolver.
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(tokio::net::lookup_host((host, 0))
                .await?
                .map(|address| address.ip())
                .collect());
        }
        Err(error) => return Err(error),
    };
    if !output.status.success() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "host name did not resolve",
        ));
    }
    let addresses = parse_ahosts(&String::from_utf8_lossy(&output.stdout));
    if addresses.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "host name has no addresses",
        ));
    }
    Ok(addresses)
}

/// Keeps NSS preference order; `ahosts` repeats each address per socket type.
fn parse_ahosts(output: &str) -> Vec<IpAddr> {
    let mut seen = HashSet::new();
    output
        .lines()
        .filter_map(|line| line.split_whitespace().next()?.parse::<IpAddr>().ok())
        .filter(|address| seen.insert(*address))
        .collect()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::net::IpAddr;

    use super::parse_ahosts;

    #[test]
    fn keeps_nss_order_and_drops_socket_type_repeats() {
        // `getent ahosts` on an IPv6-only host with DNS64.
        let output = "64:ff9b::b9c7:6d85 STREAM release-assets.githubusercontent.com\n\
64:ff9b::b9c7:6d85 DGRAM  \n\
64:ff9b::b9c7:6d85 RAW    \n\
64:ff9b::b9c7:6e85 STREAM \n\
64:ff9b::b9c7:6e85 DGRAM  \n\
185.199.108.133 STREAM \n";
        let expected: Vec<IpAddr> = [
            "64:ff9b::b9c7:6d85",
            "64:ff9b::b9c7:6e85",
            "185.199.108.133",
        ]
        .iter()
        .map(|address| address.parse().expect("test address"))
        .collect();
        assert_eq!(parse_ahosts(output), expected);
    }

    #[test]
    fn ignores_lines_without_an_address() {
        assert!(parse_ahosts("\nnot-an-address STREAM host\n").is_empty());
    }
}
