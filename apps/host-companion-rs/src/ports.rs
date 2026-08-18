use std::{collections::HashSet, process::Command, time::SystemTime};

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures_util::SinkExt;
use serde::Serialize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

const MAX_PORTS: usize = 256;
const MAX_FRAME_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPort {
    pub port: u16,
    pub name: String,
    pub process: Option<String>,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub kind: &'static str,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Listener {
    port: u16,
    process: Option<String>,
    pid: Option<u32>,
}

/// Finds IPv4 TCP listeners without probing or connecting to them.
pub async fn discover(excluded: Vec<u16>) -> Vec<DiscoveredPort> {
    tokio::task::spawn_blocking(move || {
        let excluded = excluded.into_iter().collect();
        discover_blocking(&excluded)
    })
    .await
    .unwrap_or_default()
}

fn discover_blocking(excluded: &HashSet<u16>) -> Vec<DiscoveredPort> {
    let listeners = Command::new("ss")
        .args(["-H", "-4", "-ltnp"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map_or_else(read_proc_listeners, |output| {
            parse_ss_listeners(&String::from_utf8_lossy(&output.stdout))
        });
    let mut seen = HashSet::new();
    listeners
        .into_iter()
        .filter(|listener| listener.port >= 1024 && !excluded.contains(&listener.port))
        .filter(|listener| seen.insert(listener.port))
        .take(MAX_PORTS)
        .map(enrich)
        .collect()
}

fn parse_ss_listeners(output: &str) -> Vec<Listener> {
    output.lines().filter_map(parse_ss_listener).collect()
}

fn parse_ss_listener(line: &str) -> Option<Listener> {
    let endpoint = line.split_whitespace().nth(3)?;
    let port = endpoint.rsplit(':').next()?.parse::<u16>().ok()?;
    let process_start = line.find("users:((\"").map(|index| index + 9);
    let process = process_start.and_then(|start| {
        let tail = line.get(start..)?;
        let end = tail.find('\"')?;
        Some(tail[..end].to_owned())
    });
    let pid = line
        .find("pid=")
        .and_then(|index| line.get(index + 4..))
        .and_then(|tail| {
            tail.split(|character: char| !character.is_ascii_digit())
                .next()
        })
        .and_then(|value| value.parse::<u32>().ok());
    Some(Listener { port, process, pid })
}

fn read_proc_listeners() -> Vec<Listener> {
    std::fs::read_to_string("/proc/net/tcp")
        .unwrap_or_default()
        .lines()
        .skip(1)
        .filter_map(|line| {
            let columns = line.split_whitespace().collect::<Vec<_>>();
            if columns.get(3).copied() != Some("0A") {
                return None;
            }
            let encoded = columns.get(1)?.split(':').nth(1)?;
            let port = u16::from_str_radix(encoded, 16).ok()?;
            Some(Listener {
                port,
                process: None,
                pid: None,
            })
        })
        .collect()
}

fn enrich(listener: Listener) -> DiscoveredPort {
    let cwd = listener
        .pid
        .and_then(|pid| std::fs::read_link(format!("/proc/{pid}/cwd")).ok())
        .map(|path| path.to_string_lossy().into_owned());
    let command = listener.pid.and_then(|pid| {
        std::fs::read(format!("/proc/{pid}/cmdline"))
            .ok()
            .map(|bytes| String::from_utf8_lossy(&bytes).replace('\0', " "))
    });
    let kind = infer_kind(
        listener.process.as_deref(),
        listener.port,
        command.as_deref(),
    );
    let name = service_name(listener.process.as_deref(), kind, command.as_deref());
    DiscoveredPort {
        port: listener.port,
        name,
        process: listener.process,
        pid: listener.pid,
        cwd,
        kind,
    }
}

fn infer_kind(process: Option<&str>, port: u16, command: Option<&str>) -> &'static str {
    let normalized =
        format!("{} {}", process.unwrap_or(""), command.unwrap_or("")).to_ascii_lowercase();
    if normalized.contains("docker") || normalized.contains("container") {
        "container"
    } else if ["node", "bun", "vite"]
        .iter()
        .any(|part| normalized.contains(part))
    {
        "node"
    } else if ["python", "uvicorn", "gunicorn"]
        .iter()
        .any(|part| normalized.contains(part))
    {
        "python"
    } else if [80, 443, 3000, 4173, 4200, 5173, 8000, 8080, 8765].contains(&port) {
        "web"
    } else {
        "service"
    }
}

fn service_name(process: Option<&str>, kind: &str, command: Option<&str>) -> String {
    let normalized = command.unwrap_or("").to_ascii_lowercase();
    for (needle, name) in [
        ("storybook", "Storybook"),
        ("vite", "Vite"),
        ("next", "Next.js"),
        ("webpack", "Webpack"),
        ("expo start", "Metro"),
        ("metro", "Metro"),
        ("uvicorn", "Uvicorn"),
        ("jupyter", "Jupyter"),
    ] {
        if normalized.contains(needle) {
            return name.to_owned();
        }
    }
    process
        .filter(|value| !value.trim().is_empty())
        .map_or_else(
            || {
                if kind == "web" {
                    "Web service"
                } else {
                    "Local service"
                }
                .to_owned()
            },
            ToOwned::to_owned,
        )
}

/// Transparently bridges binary WebSocket frames to one host-loopback TCP
/// stream. Awaited writes provide bounded backpressure in both directions.
pub async fn bridge_tcp(mut socket: WebSocket, mut target: TcpStream) {
    let mut host_buffer = vec![0_u8; 64 * 1024];
    loop {
        tokio::select! {
            phone = socket.recv() => match phone {
                Some(Ok(Message::Binary(bytes))) if bytes.len() <= MAX_FRAME_BYTES => {
                    if target.write_all(&bytes).await.is_err() { break; }
                }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(Message::Ping(bytes))) => {
                    if socket.send(Message::Pong(bytes)).await.is_err() { break; }
                }
                Some(Ok(Message::Pong(_))) => {}
                Some(Ok(Message::Text(_) | Message::Binary(_))) => {
                    let _ = socket.send(Message::Close(Some(CloseFrame {
                        code: 1003,
                        reason: "binary_frames_required".into(),
                    }))).await;
                    break;
                }
            },
            host = target.read(&mut host_buffer) => match host {
                Ok(0) | Err(_) => break,
                Ok(bytes) => {
                    if socket.send(Message::Binary(host_buffer[..bytes].to_vec().into())).await.is_err() { break; }
                }
            }
        }
    }
    let _ = target.shutdown().await;
    let _ = socket.close().await;
}

#[must_use]
pub fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ss_shape() {
        let parsed = parse_ss_listeners(
            "LISTEN 0 511 127.0.0.1:8765 0.0.0.0:* users:((\"node\",pid=123,fd=20))\n",
        );
        assert_eq!(parsed[0].port, 8765);
        assert_eq!(parsed[0].process.as_deref(), Some("node"));
        assert_eq!(parsed[0].pid, Some(123));
    }
}
