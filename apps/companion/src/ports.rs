use std::{
    collections::{HashMap, HashSet},
    process::Command,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime},
};

use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures_util::SinkExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

use crate::auth::AuthorizationChange;

const MAX_PORTS: usize = 256;
const MAX_FRAME_BYTES: usize = 1024 * 1024;
const FULL_REFRESH_INTERVAL: Duration = Duration::from_mins(5);

static DISCOVERY_CACHE: OnceLock<Mutex<DiscoveryCache>> = OnceLock::new();

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPort {
    pub port: u16,
    pub name: String,
    pub group: String,
    pub details: String,
    pub process: Option<String>,
    pub pid: Option<u32>,
    pub cwd: Option<String>,
    pub kind: &'static str,
    pub forwarding_key: String,
    pub default_forwarding_enabled: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Listener {
    port: u16,
    process: Option<String>,
    pid: Option<u32>,
    user_id: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct Process {
    pid: u32,
    parent_pid: u32,
    user_id: u32,
    user: String,
    command: String,
    arguments: String,
    cwd: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct DockerService {
    container: String,
    image: String,
    project: String,
    service: String,
    container_port: u16,
}

#[derive(Debug, Default)]
struct Inventory {
    current_user_id: Option<u32>,
    listeners: Vec<Listener>,
    processes: HashMap<u32, Process>,
    docker_by_port: HashMap<u16, DockerService>,
}

#[derive(Debug, Default)]
struct DiscoveryCache {
    fingerprint: Vec<u16>,
    ports: Vec<DiscoveredPort>,
    refreshed_at: Option<Instant>,
}

#[derive(Debug)]
struct RecognizedService {
    name: String,
    group: String,
    details: String,
    kind: &'static str,
}

struct RecognitionContext<'a> {
    listener: &'a Listener,
    process: Option<&'a Process>,
    inventory: &'a Inventory,
    cwd: Option<&'a str>,
    text: String,
    executable: String,
    details: String,
}

/// Lazily inventories IPv4 TCP listeners when a client asks for discovery.
/// Known developer services are enabled automatically; system-owned and
/// unknown ephemeral listeners remain visible but require explicit inclusion.
pub async fn discover(excluded: Vec<u16>) -> Vec<DiscoveredPort> {
    tokio::task::spawn_blocking(move || {
        let excluded = excluded.into_iter().collect();
        discover_blocking(&excluded)
    })
    .await
    .unwrap_or_default()
}

/// Resolves a forwarding identity from a fresh process inventory. Unlike catalog
/// discovery this deliberately bypasses the cache: it is an authorization check
/// performed immediately before a localhost connection is opened.
pub async fn forwarding_key_for_port(port: u16) -> Option<String> {
    tokio::task::spawn_blocking(move || {
        let inventory = inventory();
        inventory
            .listeners
            .iter()
            .find(|listener| listener.port == port)
            .map(|listener| enrich(listener, &inventory).forwarding_key)
    })
    .await
    .ok()
    .flatten()
}

fn discover_blocking(excluded: &HashSet<u16>) -> Vec<DiscoveredPort> {
    let fingerprint = listener_fingerprint();
    let cache = DISCOVERY_CACHE.get_or_init(|| Mutex::new(DiscoveryCache::default()));
    let mut cache = cache
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let fresh = cache
        .refreshed_at
        .is_some_and(|refreshed_at| refreshed_at.elapsed() < FULL_REFRESH_INTERVAL);
    if fresh && cache.fingerprint == fingerprint {
        return filter_discovered(&cache.ports, excluded);
    }
    let ports = discover_all();
    cache.fingerprint = listener_ports(&ports);
    cache.ports = ports;
    cache.refreshed_at = Some(Instant::now());
    filter_discovered(&cache.ports, excluded)
}

fn discover_all() -> Vec<DiscoveredPort> {
    let inventory = inventory();
    let mut seen = HashSet::new();
    let mut ports = inventory
        .listeners
        .iter()
        .filter(|listener| listener.port >= 1024)
        .filter(|listener| seen.insert(listener.port))
        .map(|listener| enrich(listener, &inventory))
        .collect::<Vec<_>>();
    ports.sort_unstable_by_key(|service| service.port);
    ports.truncate(MAX_PORTS);
    ports
}

fn filter_discovered(ports: &[DiscoveredPort], excluded: &HashSet<u16>) -> Vec<DiscoveredPort> {
    ports
        .iter()
        .filter(|service| !excluded.contains(&service.port))
        .cloned()
        .collect()
}

fn listener_fingerprint() -> Vec<u16> {
    let listeners = Command::new("ss")
        .args(["-H", "-4", "-ltn"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map_or_else(read_proc_listeners, |output| {
            parse_ss_listeners(&String::from_utf8_lossy(&output.stdout))
        });
    let mut ports = listeners
        .into_iter()
        .filter(|listener| listener.port >= 1024)
        .map(|listener| listener.port)
        .collect::<Vec<_>>();
    ports.sort_unstable();
    ports.dedup();
    ports.truncate(MAX_PORTS);
    ports
}

fn listener_ports(ports: &[DiscoveredPort]) -> Vec<u16> {
    let mut values = ports.iter().map(|service| service.port).collect::<Vec<_>>();
    values.sort_unstable();
    values.dedup();
    values
}

fn inventory() -> Inventory {
    let listeners = Command::new("ss")
        .args(["-H", "-4", "-ltnpe"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map_or_else(read_proc_listeners, |output| {
            parse_ss_listeners(&String::from_utf8_lossy(&output.stdout))
        });
    let mut processes = read_processes();
    for listener in &listeners {
        let Some(pid) = listener.pid else { continue };
        let Some(process) = processes.get_mut(&pid) else {
            continue;
        };
        process.cwd = std::fs::read_link(format!("/proc/{pid}/cwd"))
            .ok()
            .map(|path| path.to_string_lossy().into_owned());
    }
    Inventory {
        current_user_id: command_text("id", &["-u"]).and_then(|value| value.trim().parse().ok()),
        listeners,
        processes,
        docker_by_port: read_docker_services(),
    }
}

fn parse_ss_listeners(output: &str) -> Vec<Listener> {
    output.lines().filter_map(parse_ss_listener).collect()
}

fn parse_ss_listener(line: &str) -> Option<Listener> {
    let endpoint = line.split_whitespace().nth(3)?;
    let port = endpoint.rsplit(':').next()?.parse::<u16>().ok()?;
    let process = quoted_process(line);
    let pid = numeric_field(line, "pid=");
    // iproute2 omits `uid:0`; a visible row without uid is root-owned.
    let user_id = Some(numeric_field(line, "uid:").unwrap_or(0));
    Some(Listener {
        port,
        process,
        pid,
        user_id,
    })
}

fn quoted_process(line: &str) -> Option<String> {
    let start = line.find("users:((\"").map(|index| index + 9)?;
    let tail = line.get(start..)?;
    Some(tail.get(..tail.find('"')?)?.to_owned())
}

fn numeric_field(line: &str, marker: &str) -> Option<u32> {
    line.find(marker)
        .and_then(|index| line.get(index + marker.len()..))
        .and_then(|tail| {
            tail.split(|character: char| !character.is_ascii_digit())
                .next()
        })
        .and_then(|value| value.parse().ok())
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
                user_id: None,
            })
        })
        .collect()
}

fn read_processes() -> HashMap<u32, Process> {
    let Some(output) = command_text("ps", &["-eo", "pid=,ppid=,uid=,user=,comm=,args="]) else {
        return HashMap::new();
    };
    output
        .lines()
        .filter_map(parse_process)
        .map(|process| (process.pid, process))
        .collect()
}

fn parse_process(line: &str) -> Option<Process> {
    let mut fields = line.split_whitespace();
    let pid = fields.next()?.parse().ok()?;
    let parent_pid = fields.next()?.parse().ok()?;
    let user_id = fields.next()?.parse().ok()?;
    let user = fields.next()?.to_owned();
    let command = fields.next()?.to_owned();
    let arguments = fields.collect::<Vec<_>>().join(" ");
    Some(Process {
        pid,
        parent_pid,
        user_id,
        user,
        command,
        arguments,
        cwd: None,
    })
}

fn read_docker_services() -> HashMap<u16, DockerService> {
    let Some(output) = command_text(
        "docker",
        &[
            "ps",
            "--format",
            "{{.Names}}|{{.Image}}|{{.Ports}}|{{.Label \"com.docker.compose.project\"}}|{{.Label \"com.docker.compose.service\"}}",
        ],
    ) else {
        return HashMap::new();
    };
    let mut result = HashMap::new();
    for line in output.lines() {
        let fields = line.split('|').collect::<Vec<_>>();
        if fields.len() < 5 {
            continue;
        }
        for mapping in fields[2].split(',') {
            let Some((host, target)) = mapping.trim().rsplit_once("->") else {
                continue;
            };
            let Some(host_port) = host
                .rsplit(':')
                .next()
                .and_then(|value| value.parse::<u16>().ok())
            else {
                continue;
            };
            let Some(container_port) = target
                .split('/')
                .next()
                .and_then(|value| value.parse::<u16>().ok())
            else {
                continue;
            };
            result.insert(
                host_port,
                DockerService {
                    container: fields[0].to_owned(),
                    image: fields[1].to_owned(),
                    project: fields[3].to_owned(),
                    service: fields[4].to_owned(),
                    container_port,
                },
            );
        }
    }
    result
}

fn command_text(command: &str, arguments: &[&str]) -> Option<String> {
    Command::new(command)
        .args(arguments)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).into_owned())
}

fn enrich(listener: &Listener, inventory: &Inventory) -> DiscoveredPort {
    let process_id = listener
        .pid
        .or_else(|| infer_process_id(listener, inventory));
    let process = process_id.and_then(|pid| inventory.processes.get(&pid));
    let chain = process_chain(process_id, inventory);
    let recognized = recognize(listener, process, &chain, inventory);
    let forwarding_key = forwarding_key(listener, process, &recognized, inventory);
    let default_forwarding_enabled = recognized.kind != "system"
        && (listener.port <= 32_767 || !matches!(recognized.kind, "process" | "system"));
    DiscoveredPort {
        port: listener.port,
        name: recognized.name,
        group: recognized.group,
        details: recognized.details,
        process: process
            .map(|value| value.command.clone())
            .or_else(|| listener.process.clone()),
        pid: process_id,
        cwd: process.and_then(|value| value.cwd.clone()),
        kind: recognized.kind,
        forwarding_key,
        default_forwarding_enabled,
    }
}

fn infer_process_id(listener: &Listener, inventory: &Inventory) -> Option<u32> {
    let port = listener.port.to_string();
    let candidates = inventory
        .processes
        .values()
        .filter(|process| {
            listener
                .user_id
                .is_none_or(|user_id| process.user_id == user_id)
                && contains_number(&process.arguments, &port)
        })
        .collect::<Vec<_>>();
    if candidates.len() == 1 {
        return Some(candidates[0].pid);
    }
    let candidate_ids = candidates
        .iter()
        .map(|process| process.pid)
        .collect::<HashSet<_>>();
    let leaves = candidates
        .into_iter()
        .filter(|process| {
            !inventory
                .processes
                .values()
                .any(|child| child.parent_pid == process.pid && candidate_ids.contains(&child.pid))
        })
        .collect::<Vec<_>>();
    let non_wrappers = leaves
        .iter()
        .filter(|process| {
            !matches!(
                process.command.as_str(),
                "bash" | "fish" | "sh" | "timeout" | "tmux"
            )
        })
        .collect::<Vec<_>>();
    if non_wrappers.len() == 1 {
        Some(non_wrappers[0].pid)
    } else {
        None
    }
}

fn process_chain(start: Option<u32>, inventory: &Inventory) -> Vec<&Process> {
    let mut result = Vec::new();
    let mut current = start;
    let mut visited = HashSet::new();
    while let Some(pid) = current {
        if result.len() >= 6 || !visited.insert(pid) {
            break;
        }
        let Some(process) = inventory.processes.get(&pid) else {
            break;
        };
        result.push(process);
        current = (process.parent_pid != pid).then_some(process.parent_pid);
    }
    result
}

fn recognize(
    listener: &Listener,
    process: Option<&Process>,
    chain: &[&Process],
    inventory: &Inventory,
) -> RecognizedService {
    let cwd = process.and_then(|value| value.cwd.as_deref());
    let context = RecognitionContext {
        listener,
        process,
        inventory,
        cwd,
        text: chain
            .iter()
            .map(|value| format!("{} {}", value.command, value.arguments))
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase(),
        executable: process
            .map_or_else(
                || listener.process.as_deref().unwrap_or("tcp"),
                |value| value.command.as_str(),
            )
            .to_ascii_lowercase(),
        details: standard_details(process, cwd),
    };
    recognize_container(&context)
        .or_else(|| recognize_zrok(&context))
        .or_else(|| recognize_hermes(&context))
        .or_else(|| recognize_kubernetes(&context))
        .or_else(|| recognize_system(&context))
        .or_else(|| recognize_developer_runtime(&context))
        .unwrap_or_else(|| recognize_generic(&context))
}

fn recognize_container(context: &RecognitionContext<'_>) -> Option<RecognizedService> {
    let docker = context
        .inventory
        .docker_by_port
        .get(&context.listener.port)?;
    let image = docker.image.to_ascii_lowercase();
    if image.contains("k8s-minikube/kicbase") || image.contains("minikube") {
        let name = match docker.container_port {
            22 => "Minikube SSH".to_owned(),
            2376 => "Minikube Docker".to_owned(),
            5000 => "Minikube Registry".to_owned(),
            8443 => "Minikube Kubernetes API".to_owned(),
            32443 => "Minikube HTTPS".to_owned(),
            value => format!("Minikube :{value}"),
        };
        return Some(RecognizedService {
            name,
            group: format!("Minikube · {}", docker.container),
            details: joined(&[
                &format!("{}:{}", docker.container, docker.container_port),
                &docker.image,
            ]),
            kind: "minikube",
        });
    }
    Some(RecognizedService {
        name: if docker.service.is_empty() {
            docker.container.clone()
        } else {
            docker.service.clone()
        },
        group: if docker.project.is_empty() {
            "Docker".to_owned()
        } else {
            docker.project.clone()
        },
        details: joined(&[&docker.container, &docker.image]),
        kind: "docker",
    })
}

fn recognize_zrok(context: &RecognitionContext<'_>) -> Option<RecognizedService> {
    if let Some((name, details)) = zrok_share(context.listener.port, context.inventory) {
        return Some(RecognizedService {
            name,
            group: "zrok Shares".to_owned(),
            details,
            kind: "zrok",
        });
    }
    let default_agent = context.listener.port == 8888
        && context.inventory.processes.values().any(|value| {
            value
                .arguments
                .to_ascii_lowercase()
                .contains("zrok agent start")
        });
    if !context.text.contains("zrok") && !default_agent {
        return None;
    }
    let name = if context.text.contains("agent start") {
        "zrok Admin Panel"
    } else if context.text.contains("access private") {
        "zrok Private Access"
    } else {
        "zrok"
    };
    Some(RecognizedService {
        name: name.to_owned(),
        group: "zrok".to_owned(),
        details: context.details.clone(),
        kind: "zrok",
    })
}

fn recognize_hermes(context: &RecognitionContext<'_>) -> Option<RecognizedService> {
    if context.executable != "hermes"
        && !["/opt/hermes/", "hermes dashboard", "hermes gateway"]
            .iter()
            .any(|needle| context.text.contains(needle))
    {
        return None;
    }
    let name = if context.text.contains("hermes dashboard") {
        "Hermes Dashboard"
    } else if context.text.contains("hermes gateway") {
        "Hermes Gateway"
    } else {
        "Hermes"
    };
    Some(RecognizedService {
        name: name.to_owned(),
        group: "Hermes".to_owned(),
        details: context.details.clone(),
        kind: "hermes",
    })
}

fn recognize_kubernetes(context: &RecognitionContext<'_>) -> Option<RecognizedService> {
    if !context.text.contains("kubectl") {
        return None;
    }
    let arguments = context
        .process
        .map_or(context.text.as_str(), |value| value.arguments.as_str());
    if context.text.contains("port-forward") {
        let resource = kubernetes_resource(arguments).unwrap_or("Kubernetes service");
        let name = resource.rsplit('/').next().unwrap_or(resource).to_owned();
        let group = kubernetes_group(
            option_value(arguments, "--context", None),
            option_value(arguments, "--namespace", Some("-n")),
        );
        return Some(RecognizedService {
            name,
            group,
            details: context.details.clone(),
            kind: "kubernetes",
        });
    }
    if !contains_word(&context.text, "proxy") {
        return None;
    }
    let group = option_value(arguments, "--context", None).map_or_else(
        || "Kubernetes".to_owned(),
        |value| format!("Kubernetes · {value}"),
    );
    Some(RecognizedService {
        name: "Kubernetes API Proxy".to_owned(),
        group,
        details: context.details.clone(),
        kind: "kubernetes",
    })
}

fn recognize_system(context: &RecognitionContext<'_>) -> Option<RecognizedService> {
    let is_system = context
        .listener
        .user_id
        .zip(context.inventory.current_user_id)
        .is_some_and(|(owner, current)| owner != current);
    if !is_system {
        return None;
    }
    let name = context
        .process
        .map(|value| value.command.clone())
        .or_else(|| context.listener.process.clone())
        .unwrap_or_else(|| {
            context.listener.user_id.map_or_else(
                || "System TCP".to_owned(),
                |value| {
                    if value == 0 {
                        "root service".to_owned()
                    } else {
                        format!("UID {value} service")
                    }
                },
            )
        });
    Some(RecognizedService {
        name,
        group: "System services".to_owned(),
        details: context.details.clone(),
        kind: "system",
    })
}

fn recognize_developer_runtime(context: &RecognitionContext<'_>) -> Option<RecognizedService> {
    if context.text.contains("vite") {
        return Some(RecognizedService {
            name: "Vite".to_owned(),
            group: context.cwd.unwrap_or("Vite").to_owned(),
            details: context.details.clone(),
            kind: "vite",
        });
    }
    let runtimes = ["node", "bun", "pnpm", "npm", "yarn"];
    if runtimes.iter().any(|runtime| {
        contains_word(&context.executable, runtime) || contains_word(&context.text, runtime)
    }) {
        let name = ["bun", "pnpm", "yarn", "npm"]
            .into_iter()
            .find(|runtime| {
                contains_word(&context.executable, runtime) || contains_word(&context.text, runtime)
            })
            .map_or("Node".to_owned(), |runtime| {
                if runtime == "bun" {
                    "Bun".to_owned()
                } else {
                    runtime.to_owned()
                }
            });
        return Some(RecognizedService {
            name,
            group: context.cwd.unwrap_or("Bun / Node").to_owned(),
            details: context.details.clone(),
            kind: "node",
        });
    }
    if !context.executable.contains("python") {
        return None;
    }
    let name = if context.text.contains("http.server") {
        "Python HTTP Server"
    } else {
        "Python"
    };
    Some(RecognizedService {
        name: name.to_owned(),
        group: context.cwd.unwrap_or("Python").to_owned(),
        details: context.details.clone(),
        kind: "python",
    })
}

fn recognize_generic(context: &RecognitionContext<'_>) -> RecognizedService {
    RecognizedService {
        name: context
            .process
            .map(|value| value.command.clone())
            .or_else(|| context.listener.process.clone())
            .unwrap_or_else(|| "TCP process".to_owned()),
        group: context.cwd.unwrap_or("User processes").to_owned(),
        details: context.details.clone(),
        kind: "process",
    }
}

fn standard_details(process: Option<&Process>, cwd: Option<&str>) -> String {
    let mut values = Vec::new();
    if let Some(process) = process {
        values.push(process.arguments.as_str());
        values.push(process.user.as_str());
    }
    if let Some(cwd) = cwd {
        values.push(cwd);
    }
    joined(&values)
}

fn joined(values: &[&str]) -> String {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>()
        .join(" · ")
}

fn zrok_share(port: u16, inventory: &Inventory) -> Option<(String, String)> {
    let targets = [
        format!("http://127.0.0.1:{port}"),
        format!("https://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
        format!("https://localhost:{port}"),
    ];
    inventory.processes.values().find_map(|process| {
        let lower = process.arguments.to_ascii_lowercase();
        if !lower.contains("zrok share public")
            || !targets.iter().any(|target| lower.contains(target))
        {
            return None;
        }
        let name = option_value(&process.arguments, "--name-selection", None)
            .and_then(|value| value.split_once(':').map(|(_, suffix)| suffix));
        Some((
            name.map_or_else(
                || "zrok Share".to_owned(),
                |value| format!("zrok Share · {value}"),
            ),
            process.arguments.clone(),
        ))
    })
}

fn kubernetes_resource(arguments: &str) -> Option<&str> {
    let tokens = arguments.split_whitespace().collect::<Vec<_>>();
    let start = tokens.iter().rposition(|token| *token == "port-forward")? + 1;
    let options_with_values = [
        "--address",
        "--context",
        "--kubeconfig",
        "--namespace",
        "--pod-running-timeout",
        "--request-timeout",
        "--server",
        "-n",
        "-s",
    ];
    let mut index = start;
    while index < tokens.len() {
        let token = tokens[index];
        if token.starts_with('-') {
            let option = token.split('=').next().unwrap_or(token);
            index += usize::from(!token.contains('=') && options_with_values.contains(&option)) + 1;
        } else if is_port_mapping(token) {
            index += 1;
        } else {
            return Some(token);
        }
    }
    None
}

fn is_port_mapping(value: &str) -> bool {
    let value = value.rsplit(':').take(2).collect::<Vec<_>>();
    value.len() == 2 && value.iter().all(|part| part.parse::<u16>().is_ok())
}

fn option_value<'a>(arguments: &'a str, long: &str, short: Option<&str>) -> Option<&'a str> {
    let tokens = arguments.split_whitespace().collect::<Vec<_>>();
    for (index, token) in tokens.iter().enumerate() {
        for option in [Some(long), short].into_iter().flatten() {
            if *token == option {
                return tokens.get(index + 1).copied();
            }
            if let Some(value) = token.strip_prefix(&format!("{option}=")) {
                return Some(value);
            }
        }
    }
    None
}

fn kubernetes_group(context: Option<&str>, namespace: Option<&str>) -> String {
    match (context, namespace) {
        (Some(context), Some(namespace)) if namespace != "default" && namespace != context => {
            format!("Kubernetes · {context} / {namespace}")
        }
        (Some(context), _) => format!("Kubernetes · {context}"),
        (None, Some(namespace)) => format!("Kubernetes · {namespace}"),
        (None, None) => "Kubernetes".to_owned(),
    }
}

fn forwarding_key(
    listener: &Listener,
    process: Option<&Process>,
    recognized: &RecognizedService,
    inventory: &Inventory,
) -> String {
    let components = if let Some(docker) = inventory.docker_by_port.get(&listener.port) {
        vec![
            recognized.kind.to_owned(),
            "docker".to_owned(),
            docker.project.clone(),
            docker.service.clone(),
            docker.container.clone(),
            format!("container-port:{}", docker.container_port),
        ]
    } else {
        let arguments = process
            .map(|value| normalize_port(&value.arguments, listener.port))
            .unwrap_or_default();
        let shared_ports = process.map_or(0, |value| {
            inventory
                .listeners
                .iter()
                .filter(|candidate| candidate.pid == Some(value.pid))
                .count()
        });
        let arguments_contain_port = process
            .is_some_and(|value| contains_number(&value.arguments, &listener.port.to_string()));
        let mut values = vec![
            recognized.kind.to_owned(),
            recognized.name.clone(),
            recognized.group.clone(),
        ];
        if let Some(process) = process {
            values.push(process.command.clone());
            values.push(arguments);
            values.push(process.cwd.clone().unwrap_or_default());
        }
        if let Some(command) = &listener.process {
            values.push(command.clone());
        }
        if process.is_none() || (shared_ports > 1 && !arguments_contain_port) {
            values.push(format!("port:{}", listener.port));
        }
        values
    };
    let mut digest = Sha256::new();
    digest.update(components.join("\u{1f}").as_bytes());
    hex::encode(digest.finalize())
}

fn normalize_port(arguments: &str, port: u16) -> String {
    let port = port.to_string();
    let mut output = String::with_capacity(arguments.len());
    let mut index = 0;
    while let Some(offset) = arguments[index..].find(&port) {
        let start = index + offset;
        let end = start + port.len();
        let left_ok = start == 0 || !arguments.as_bytes()[start - 1].is_ascii_digit();
        let right_ok = end == arguments.len() || !arguments.as_bytes()[end].is_ascii_digit();
        output.push_str(&arguments[index..start]);
        output.push_str(if left_ok && right_ok {
            "{port}"
        } else {
            &arguments[start..end]
        });
        index = end;
    }
    output.push_str(&arguments[index..]);
    output
}

fn contains_number(text: &str, number: &str) -> bool {
    text.match_indices(number).any(|(start, value)| {
        let end = start + value.len();
        (start == 0 || !text.as_bytes()[start - 1].is_ascii_digit())
            && (end == text.len() || !text.as_bytes()[end].is_ascii_digit())
    })
}

fn contains_word(text: &str, word: &str) -> bool {
    text.match_indices(word).any(|(start, value)| {
        let end = start + value.len();
        (start == 0 || !text.as_bytes()[start - 1].is_ascii_alphanumeric())
            && (end == text.len() || !text.as_bytes()[end].is_ascii_alphanumeric())
    })
}

/// Bridges binary WebSocket frames to one host-loopback TCP stream.
pub async fn bridge_tcp(mut socket: WebSocket, mut target: TcpStream) {
    bridge_tcp_with_authorization(&mut socket, &mut target, None, None).await;
}

/// Bridges an unauthenticated carrier while bounding inactive permit retention.
pub async fn bridge_tcp_idle_bounded(
    mut socket: WebSocket,
    mut target: TcpStream,
    idle_timeout: Duration,
) {
    bridge_tcp_with_authorization(&mut socket, &mut target, None, Some(idle_timeout)).await;
}

pub async fn bridge_tcp_authorized(
    mut socket: WebSocket,
    mut target: TcpStream,
    device_id: String,
    authorization_changes: tokio::sync::broadcast::Receiver<AuthorizationChange>,
) {
    bridge_tcp_with_authorization(
        &mut socket,
        &mut target,
        Some((device_id, authorization_changes)),
        None,
    )
    .await;
}

async fn bridge_tcp_with_authorization(
    socket: &mut WebSocket,
    target: &mut TcpStream,
    mut authorization: Option<(
        String,
        tokio::sync::broadcast::Receiver<AuthorizationChange>,
    )>,
    idle_timeout: Option<Duration>,
) {
    let mut host_buffer = vec![0_u8; 64 * 1024];
    let mut idle = idle_timeout.map(|duration| Box::pin(tokio::time::sleep(duration)));
    loop {
        tokio::select! {
            phone = socket.recv() => match phone {
                Some(Ok(Message::Binary(bytes))) if bytes.len() <= MAX_FRAME_BYTES => {
                    if target.write_all(&bytes).await.is_err() { break; }
                    reset_idle(&mut idle, idle_timeout);
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
                    reset_idle(&mut idle, idle_timeout);
                }
            },
            () = wait_for_idle(&mut idle), if idle.is_some() => break,
            change = receive_authorization_change(&mut authorization), if authorization.is_some() => {
                match change {
                    Ok(change) if authorization.as_ref().is_some_and(|(device_id, _)| device_id == &change.device_id) => break,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_) | tokio::sync::broadcast::error::RecvError::Closed) => break,
                    Ok(_) => {}
                }
            }
        }
    }
    let _ = target.shutdown().await;
    let _ = socket.close().await;
}

async fn wait_for_idle(idle: &mut Option<std::pin::Pin<Box<tokio::time::Sleep>>>) {
    match idle {
        Some(idle) => idle.as_mut().await,
        None => std::future::pending().await,
    }
}

fn reset_idle(
    idle: &mut Option<std::pin::Pin<Box<tokio::time::Sleep>>>,
    idle_timeout: Option<Duration>,
) {
    if let (Some(idle), Some(idle_timeout)) = (idle, idle_timeout) {
        idle.as_mut()
            .reset(tokio::time::Instant::now() + idle_timeout);
    }
}

async fn receive_authorization_change(
    authorization: &mut Option<(
        String,
        tokio::sync::broadcast::Receiver<AuthorizationChange>,
    )>,
) -> Result<AuthorizationChange, tokio::sync::broadcast::error::RecvError> {
    match authorization {
        Some((_, changes)) => changes.recv().await,
        None => std::future::pending().await,
    }
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

    fn fixture_inventory() -> Inventory {
        let listeners = parse_ss_listeners(
            "LISTEN 0 511 127.0.0.1:4173 0.0.0.0:* users:((\"node\",pid=101,fd=20)) uid:501 ino:1\n\
             LISTEN 0 511 127.0.0.1:40000 0.0.0.0:* users:((\"code\",pid=102,fd=21)) uid:501 ino:2\n\
             LISTEN 0 511 127.0.0.1:10005 0.0.0.0:* users:((\"skycore\",pid=103,fd=22)) uid:0 ino:3\n",
        );
        let mut processes = HashMap::new();
        processes.insert(
            101,
            Process {
                pid: 101,
                parent_pid: 1,
                user_id: 501,
                user: "demo".into(),
                command: "node".into(),
                arguments: "node /repo/node_modules/vite/bin/vite.js --port 4173".into(),
                cwd: Some("/repo".into()),
            },
        );
        processes.insert(
            102,
            Process {
                pid: 102,
                parent_pid: 1,
                user_id: 501,
                user: "demo".into(),
                command: "code".into(),
                arguments: "code tunnel --on-port 40000".into(),
                cwd: Some("/repo".into()),
            },
        );
        processes.insert(
            103,
            Process {
                pid: 103,
                parent_pid: 1,
                user_id: 0,
                user: "root".into(),
                command: "skycore".into(),
                arguments: "/usr/bin/skycore".into(),
                cwd: None,
            },
        );
        Inventory {
            current_user_id: Some(501),
            listeners,
            processes,
            docker_by_port: HashMap::new(),
        }
    }

    #[test]
    fn parses_ss_shape() {
        let parsed = parse_ss_listeners(
            "LISTEN 0 511 127.0.0.1:8765 0.0.0.0:* users:((\"node\",pid=123,fd=20)) uid:501 ino:1\n",
        );
        assert_eq!(parsed[0].port, 8765);
        assert_eq!(parsed[0].process.as_deref(), Some("node"));
        assert_eq!(parsed[0].pid, Some(123));
        assert_eq!(parsed[0].user_id, Some(501));
    }

    #[test]
    fn applies_doma_default_categories_and_stable_keys() {
        let inventory = fixture_inventory();
        let services = inventory
            .listeners
            .iter()
            .map(|listener| enrich(listener, &inventory))
            .collect::<Vec<_>>();
        assert_eq!(services[0].kind, "vite");
        assert_eq!(services[0].name, "Vite");
        assert!(services[0].default_forwarding_enabled);
        assert_eq!(services[1].kind, "process");
        assert!(!services[1].default_forwarding_enabled);
        assert_eq!(services[2].kind, "system");
        assert!(!services[2].default_forwarding_enabled);
        assert_eq!(services[0].forwarding_key.len(), 64);
    }

    #[test]
    fn forwarding_key_survives_an_ephemeral_port_change() {
        let first_inventory = fixture_inventory();
        let first = enrich(&first_inventory.listeners[1], &first_inventory);
        let mut second_inventory = fixture_inventory();
        second_inventory.listeners[1].port = 45_000;
        let Some(process) = second_inventory.processes.get_mut(&102) else {
            panic!("fixture process is missing");
        };
        process.arguments = "code tunnel --on-port 45000".into();
        let second = enrich(&second_inventory.listeners[1], &second_inventory);
        assert_eq!(first.forwarding_key, second.forwarding_key);
    }
}
