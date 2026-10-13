//! Linux lookup through the host's NSS configuration (`getent ahosts`).

use std::{collections::HashSet, net::IpAddr};

/// Runs `getent ahosts <host>`; `Ok(None)` means `getent` is not installed.
///
/// The caller has already refused hosts that `getent` could read as an option.
#[cfg(target_os = "linux")]
pub(crate) async fn getent_ahosts(host: &str) -> std::io::Result<Option<Vec<IpAddr>>> {
    use std::{io, process::Stdio};

    let output = match tokio::process::Command::new("getent")
        .arg("ahosts")
        .arg(host)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .await
    {
        Ok(output) => output,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if !output.status.success() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "host name did not resolve",
        ));
    }
    Ok(Some(parse_ahosts(&String::from_utf8_lossy(&output.stdout))))
}

/// Keeps NSS preference order; `ahosts` repeats each address per socket type.
pub(crate) fn parse_ahosts(output: &str) -> Vec<IpAddr> {
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
