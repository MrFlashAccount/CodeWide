use std::collections::HashMap;

use super::Listener;

#[cfg(target_os = "macos")]
pub(super) fn read_listeners() -> Vec<Listener> {
    // LaunchAgents do not inherit an interactive shell's PATH. lsof is part of macOS.
    super::command_text(
        "/usr/sbin/lsof",
        &["-nP", "-a", "-i4TCP", "-sTCP:LISTEN", "-F0pcufn"],
    )
    .map_or_else(Vec::new, |output| parse_listeners(&output))
}

fn fields(output: &str) -> impl Iterator<Item = (&str, &str)> {
    output.split('\0').filter_map(|field| {
        let field = field.trim_start_matches('\n');
        field.split_at_checked(1)
    })
}

fn parse_listeners(output: &str) -> Vec<Listener> {
    let mut listeners = Vec::new();
    let mut pid = None;
    let mut process = None;
    let mut user_id = None;
    for (tag, value) in fields(output) {
        match tag {
            "p" => {
                pid = value.parse().ok();
                process = None;
                user_id = None;
            }
            "c" => process = Some(value.to_owned()),
            "u" => user_id = value.parse().ok(),
            "n" => {
                let Some(port) = value.rsplit(':').next().and_then(|port| port.parse().ok()) else {
                    continue;
                };
                if pid.is_some() {
                    listeners.push(Listener {
                        port,
                        process: process.clone(),
                        pid,
                        // macOS lsof exposes no inode for TCP sockets. PID and
                        // port still invalidate discovery when a listener moves.
                        inode: None,
                        user_id,
                    });
                }
            }
            _ => {}
        }
    }
    listeners
}

#[cfg(target_os = "macos")]
pub(super) fn read_working_directories(listeners: &[Listener]) -> HashMap<u32, String> {
    let mut pids = listeners
        .iter()
        .filter_map(|listener| listener.pid)
        .collect::<Vec<_>>();
    pids.sort_unstable();
    pids.dedup();
    if pids.is_empty() {
        return HashMap::new();
    }
    let pids = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    super::command_text(
        "/usr/sbin/lsof",
        &["-nP", "-a", "-p", &pids, "-d", "cwd", "-F0pn"],
    )
    .map_or_else(HashMap::new, |output| parse_working_directories(&output))
}

fn parse_working_directories(output: &str) -> HashMap<u32, String> {
    let mut directories = HashMap::new();
    let mut pid = None;
    for (tag, value) in fields(output) {
        match tag {
            "p" => pid = value.parse().ok(),
            "n" if value.starts_with('/') => {
                if let Some(pid) = pid {
                    directories.insert(pid, value.to_owned());
                }
            }
            _ => {}
        }
    }
    directories
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn listener_records_preserve_process_ownership() {
        let listeners = parse_listeners(
            "p101\0cnode\0u501\0\nf20\0n127.0.0.1:4173\0\nf21\0n*:8080\0\n\
             p102\0cOther App\0u0\0\nf3\0n127.0.0.1:9000\0\n\
             pbroken\0n127.0.0.1:9999\0\n",
        );
        assert_eq!(listeners.len(), 3);
        assert_eq!(listeners[0].port, 4173);
        assert_eq!(listeners[0].pid, Some(101));
        assert_eq!(listeners[0].user_id, Some(501));
        assert_eq!(listeners[1].port, 8080);
        assert_eq!(listeners[1].pid, Some(101));
        assert_eq!(listeners[2].pid, Some(102));
        assert_eq!(listeners[2].process.as_deref(), Some("Other App"));
        assert_eq!(listeners[2].user_id, Some(0));
    }

    #[test]
    fn working_directories_preserve_spaces_and_do_not_cross_processes() {
        let directories = parse_working_directories(
            "p101\0\nfcwd\0n/Users/test/My Project\0\np102\0\nfcwd\0n/repo\0\n\
             pbad\0\nfcwd\0n/invalid\0\n",
        );
        assert_eq!(directories.len(), 2);
        assert_eq!(
            directories.get(&101).map(String::as_str),
            Some("/Users/test/My Project")
        );
        assert_eq!(directories.get(&102).map(String::as_str), Some("/repo"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_inventory_finds_a_real_loopback_listener() -> Result<(), Box<dyn std::error::Error>> {
        let socket = std::net::TcpListener::bind("127.0.0.1:0")?;
        let listeners = read_listeners();
        let listener = listeners
            .iter()
            .find(|listener| {
                listener.port == socket.local_addr().map_or(0, |address| address.port())
            })
            .ok_or("native listener not discovered")?;
        assert_eq!(listener.pid, Some(std::process::id()));
        let directories = read_working_directories(std::slice::from_ref(listener));
        let directory = directories
            .get(&std::process::id())
            .ok_or("working directory missing")?;
        assert_eq!(
            std::path::Path::new(directory).canonicalize()?,
            std::env::current_dir()?.canonicalize()?
        );
        Ok(())
    }
}
