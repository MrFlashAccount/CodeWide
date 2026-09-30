use std::net::SocketAddr;

use nix::{ifaddrs::getifaddrs, net::if_::InterfaceFlags};

/// Enumerate again for each status/pairing request so Wi-Fi and VPN changes
/// never leave a newly created QR pointing at an address this host has lost.
pub fn endpoints(listen: SocketAddr) -> Result<Vec<String>, nix::errno::Errno> {
    if !listen.ip().is_unspecified() {
        return Ok(vec![format!("wss://{listen}/v1/sync")]);
    }
    let mut addresses = Vec::new();
    for interface in getifaddrs()? {
        let Some(priority) = interface_priority(&interface.interface_name, interface.flags) else {
            continue;
        };
        let Some(address) = interface
            .address
            .and_then(|value| value.as_sockaddr_in().copied())
        else {
            continue;
        };
        let ip = address.ip();
        if ip.is_loopback() || ip.is_unspecified() || ip.is_link_local() || ip.is_multicast() {
            continue;
        }
        addresses.push((priority, interface.interface_name, ip));
    }
    addresses.sort();
    let mut result = Vec::new();
    for (_, _, ip) in addresses {
        let endpoint = format!("wss://{ip}:{}/v1/sync", listen.port());
        if !result.contains(&endpoint) {
            result.push(endpoint);
        }
    }
    Ok(result)
}

fn interface_priority(name: &str, flags: InterfaceFlags) -> Option<u8> {
    if !flags.contains(InterfaceFlags::IFF_UP) || flags.contains(InterfaceFlags::IFF_LOOPBACK) {
        return None;
    }
    if flags.contains(InterfaceFlags::IFF_POINTOPOINT) {
        return Some(2);
    }
    if [
        "bridge", "br-", "docker", "veth", "vmnet", "vmenet", "virbr", "awdl", "llw",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
    {
        return None;
    }
    Some(u8::from(
        !["en", "eth", "wl"]
            .iter()
            .any(|prefix| name.starts_with(prefix)),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn physical_and_vpn_interfaces_remain_available() {
        assert_eq!(interface_priority("en0", InterfaceFlags::IFF_UP), Some(0));
        assert_eq!(
            interface_priority(
                "utun4",
                InterfaceFlags::IFF_UP | InterfaceFlags::IFF_POINTOPOINT
            ),
            Some(2)
        );
    }

    #[test]
    fn virtual_bridges_are_not_published_as_client_addresses() {
        for interface in [
            "bridge100",
            "br-test",
            "docker0",
            "veth123",
            "vmnet8",
            "vmenet0",
        ] {
            assert_eq!(interface_priority(interface, InterfaceFlags::IFF_UP), None);
        }
    }
}
