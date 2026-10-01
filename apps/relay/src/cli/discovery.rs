use codewide_relay::Result;
use std::{
    net::IpAddr,
    path::{Path, PathBuf},
    process::Command as Process,
    time::Duration,
};

pub struct Target {
    pub state: PathBuf,
    pub admin_group: Option<String>,
}

#[derive(Clone, Copy)]
enum ServiceScope {
    System,
    User,
}

pub fn default_state_path() -> PathBuf {
    std::env::var_os("XDG_STATE_HOME")
        .map_or_else(
            || {
                std::env::var_os("HOME").map_or_else(
                    || PathBuf::from(".local/state"),
                    |home| PathBuf::from(home).join(".local/state"),
                )
            },
            PathBuf::from,
        )
        .join("codewide/relay")
}

pub fn target(explicit: Option<&Path>) -> Result<Target> {
    if let Some(state) = explicit {
        return Ok(Target {
            state: state.to_owned(),
            admin_group: None,
        });
    }
    if let Some(scope) = active_service() {
        let pid: u32 = property(scope, "MainPID")
            .ok_or("Cannot read Relay service PID")?
            .parse()?;
        let bytes = std::fs::read(format!("/proc/{pid}/cmdline"))?;
        let args: Vec<_> = bytes
            .split(|byte| *byte == 0)
            .filter(|arg| !arg.is_empty())
            .map(std::str::from_utf8)
            .collect::<std::result::Result<_, _>>()?;
        let state = state_argument(&args).ok_or("The running Relay service must declare --state explicitly. Use --state to select its existing directory.")?;
        let admin_group = property(scope, "Group")
            .filter(|value| !value.is_empty())
            .or_else(|| property(scope, "User").filter(|value| !value.is_empty()));
        return Ok(Target {
            state: PathBuf::from(state),
            admin_group,
        });
    }
    Ok(Target {
        state: default_state_path(),
        admin_group: None,
    })
}

fn state_argument<'a>(args: &'a [&str]) -> Option<&'a str> {
    args.iter().enumerate().find_map(|(i, arg)| {
        arg.strip_prefix("--state=").or_else(|| {
            (*arg == "--state")
                .then(|| args.get(i + 1).copied())
                .flatten()
        })
    })
}

fn active_service() -> Option<ServiceScope> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    // Preserve the existing system-service preference. The installer refuses
    // ambiguous deployments rather than starting a second Relay identity.
    [ServiceScope::System, ServiceScope::User]
        .into_iter()
        .find(|scope| property(*scope, "ActiveState").as_deref() == Some("active"))
}

fn property(scope: ServiceScope, name: &str) -> Option<String> {
    let mut command = Process::new("systemctl");
    if matches!(scope, ServiceScope::User) {
        command.arg("--user");
    }
    let result = command
        .args([
            "show",
            "codewide-relay.service",
            "--property",
            name,
            "--value",
        ])
        .output()
        .ok()?;
    result
        .status
        .success()
        .then(|| String::from_utf8_lossy(&result.stdout).trim().to_owned())
}

pub fn access_denied(target: &Target) -> codewide_relay::Error {
    target.admin_group.as_ref().map_or_else(
        || "Access denied to the Relay control socket.".into(),
        |group| {
            format!(
                "Your account cannot administer this Relay. Add it to the {group} group, then sign in again."
            )
            .into()
        },
    )
}

pub async fn public_address(explicit: Option<&str>, port: u16) -> Result<String> {
    if let Some(address) = explicit {
        return checked_address(address);
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .build()?;
    let result = async {
        let mut response = client
            .get("https://api.ipify.org")
            .send()
            .await?
            .error_for_status()?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 64 {
                return Err("Public IP response is oversized".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        let address: IpAddr = std::str::from_utf8(&bytes)?.trim().parse()?;
        Ok::<_, codewide_relay::Error>(std::net::SocketAddr::new(address, port).to_string())
    }
    .await;
    result.map_err(|_| "Cannot detect public IP. Run pair --address <public-IP:port> (use the external port if your router maps it).".into())
}

fn checked_address(value: &str) -> Result<String> {
    let uri: tokio_tungstenite::tungstenite::http::uri::Authority = value.parse()?;
    if uri.port_u16().is_none_or(|port| port == 0)
        || value.contains('@')
        || value.chars().any(char::is_whitespace)
    {
        return Err("Address must be a DNS name or IP with an explicit nonzero port".into());
    }
    Ok(value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_service_arguments_and_rejects_unsafe_addresses() {
        assert_eq!(
            state_argument(&["relay", "--state", "/var/lib/relay state"]),
            Some("/var/lib/relay state")
        );
        assert_eq!(
            state_argument(&["relay", "--state=/var/lib/relay"]),
            Some("/var/lib/relay")
        );
        for address in [
            "host",
            "host:0",
            "https://host:8780",
            "user@host:8780",
            "host:8780\u{1b}[2J",
        ] {
            assert!(checked_address(address).is_err());
        }
        assert!(checked_address("[::1]:8780").is_ok());
        let target = Target {
            state: PathBuf::from("/var/lib/codewide-relay"),
            admin_group: Some("codewide-relay".into()),
        };
        let message = access_denied(&target).to_string();
        assert!(message.contains("codewide-relay group"));
        assert!(!message.contains("sudo"));
    }
}
