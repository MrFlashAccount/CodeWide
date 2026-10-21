//! The orchestration tool contract: names, descriptions and argument
//! schemas declared to every provider, the validated decoding of a call's
//! arguments and the JSON results returned to the model.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::task::{TaskId, WaitMode};
use crate::agent::model::{AppThreadId, ClientToolSpec, ProviderId};

pub const DELEGATE_TASK: &str = "codewide_delegate_task";
pub const WAIT_TASK: &str = "codewide_wait_task";
pub const CANCEL_TASK: &str = "codewide_cancel_task";
pub const SPAWN_AGENT: &str = "codewide_spawn_agent";
pub const WAIT_AGENT: &str = "codewide_wait_agent";
pub const SEND_AGENT: &str = "codewide_send_agent";
pub const CANCEL_AGENT: &str = "codewide_cancel_agent";
pub const LIST_AGENTS: &str = "codewide_list_agents";

/// Default and maximum wait of `codewide_wait_agent`.
pub const DEFAULT_WAIT: Duration = Duration::from_mins(1);
pub const MAX_WAIT: Duration = Duration::from_mins(5);

/// The declared tools, identical for every provider.
#[must_use]
pub fn specs() -> Vec<ClientToolSpec> {
    let mut specs = task_specs();
    specs.extend(compatibility_specs());
    specs
}

fn task_specs() -> Vec<ClientToolSpec> {
    let task_id = json!({
        "type": "string",
        "description": "Durable task id returned by codewide_delegate_task."
    });
    vec![
        ClientToolSpec {
            name: DELEGATE_TASK.into(),
            description: "Delegate a task to a dedicated child thread. The host preserves the task across reconnects and restarts. Use deferred to continue immediately or blocking to wait while this turn remains alive.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "The complete task for the child agent."},
                    "waitMode": {"type": "string", "enum": ["blocking", "deferred"]},
                    "provider": {"type": "string", "description": "Target provider. Default: this thread's provider."},
                    "model": {"type": "string", "description": "Target model. Default: this thread's model on the same provider, else the target provider default."},
                    "name": {"type": "string", "description": "Short child display name."},
                    "permissionProfile": {"type": "string", "description": "Requested target profile, never stronger than the parent ceiling."},
                    "workspace": {
                        "oneOf": [
                            {
                                "type": "object",
                                "properties": {
                                    "mode": {"const": "sharedReadOnly"},
                                    "cwd": {"type": "string", "description": "Absolute shared working directory; default is the parent's cwd."}
                                },
                                "required": ["mode"],
                                "additionalProperties": false
                            },
                            {
                                "type": "object",
                                "properties": {
                                    "mode": {"const": "isolatedWrite"},
                                    "sourceWorkspace": {"type": "string", "description": "Absolute source workspace; default is the parent's cwd."}
                                },
                                "required": ["mode"],
                                "additionalProperties": false
                            }
                        ]
                    }
                },
                "required": ["prompt", "waitMode", "workspace"],
                "additionalProperties": false
            }),
        },
        ClientToolSpec {
            name: WAIT_TASK.into(),
            description: "Wait for one durable delegated task. Returns only that task's initial turn result and acknowledges fallback delivery when terminal.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "taskId": task_id,
                    "timeoutSeconds": {"type": "number", "minimum": 0, "maximum": 300, "description": "Default 60, at most 300."}
                },
                "required": ["taskId"],
                "additionalProperties": false
            }),
        },
        ClientToolSpec {
            name: CANCEL_TASK.into(),
            description: "Record cancellation for one durable delegated task. Safe to repeat; cancelling is not the same as cancelled.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {"taskId": task_id},
                "required": ["taskId"],
                "additionalProperties": false
            }),
        },
    ]
}

fn compatibility_specs() -> Vec<ClientToolSpec> {
    let agent_thread_id = json!({
        "type": "string",
        "description": "Thread id of an agent this thread started (from codewide_spawn_agent or codewide_list_agents)."
    });
    vec![
        ClientToolSpec {
            name: SPAWN_AGENT.into(),
            description: "Start another agent in a new CodeWide thread, linked to this thread as a subagent, and give it a task. The new agent sees only `prompt` (not this conversation). Returns immediately; use codewide_wait_agent to collect its answer.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "description": "The complete task for the new agent."},
                    "provider": {"type": "string", "description": "Agent provider id (for example \"codex\" or \"claude\"). Default: this thread's provider."},
                    "model": {"type": "string", "description": "Model id. Default: this thread's model on the same provider, else the provider's default model."},
                    "name": {"type": "string", "description": "Short display name of the agent."},
                    "cwd": {"type": "string", "description": "Absolute working directory. Default: this thread's working directory."},
                    "permissionProfile": {"type": "string", "description": "One of :read-only, :workspace, :full-access, :danger-full-access. Default and upper bound: this thread's profile."}
                },
                "required": ["prompt"],
                "additionalProperties": false
            }),
        },
        ClientToolSpec {
            name: WAIT_AGENT.into(),
            description: "Wait until an agent of this thread finishes its current turn, or until the timeout. Returns its status and, when finished, its final message.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "agentThreadId": agent_thread_id,
                    "timeoutSeconds": {"type": "number", "minimum": 0, "maximum": 300, "description": "Default 60, at most 300."}
                },
                "required": ["agentThreadId"],
                "additionalProperties": false
            }),
        },
        ClientToolSpec {
            name: SEND_AGENT.into(),
            description: "Send a follow-up message to an agent of this thread. mode \"queue\" (default) starts a new turn when the agent is idle and otherwise delivers the message after its current turn; \"steer\" adds it to the running turn.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "agentThreadId": agent_thread_id,
                    "message": {"type": "string"},
                    "mode": {"type": "string", "enum": ["queue", "steer"]}
                },
                "required": ["agentThreadId", "message"],
                "additionalProperties": false
            }),
        },
        ClientToolSpec {
            name: CANCEL_AGENT.into(),
            description: "Interrupt the running turn of an agent of this thread and drop its queued messages. Safe to repeat.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {"agentThreadId": agent_thread_id},
                "required": ["agentThreadId"],
                "additionalProperties": false
            }),
        },
        ClientToolSpec {
            name: LIST_AGENTS.into(),
            description: "List the agents this thread started, with their provider, model, name and status.".into(),
            input_schema: json!({"type": "object", "properties": {}, "additionalProperties": false}),
        },
    ]
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WorkspaceRequest {
    SharedReadOnly {
        cwd: Option<String>,
    },
    IsolatedWrite {
        source_workspace: Option<String>,
    },
    /// Internal compatibility arm; never decoded from `codewide_delegate_task`.
    /// Admission maps it to shared read-only or isolated write and never to
    /// the persisted legacy shared-write mode.
    CompatibilitySpawn {
        cwd: Option<String>,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegateRequest {
    pub prompt: String,
    pub wait_mode: WaitMode,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub name: Option<String>,
    pub permission_profile: Option<String>,
    pub workspace: WorkspaceRequest,
}

/// How `codewide_send_agent` delivers a message.
#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SendMode {
    #[default]
    Queue,
    Steer,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SpawnRequest {
    pub prompt: String,
    pub provider: Option<ProviderId>,
    pub model: Option<String>,
    pub name: Option<String>,
    pub cwd: Option<String>,
    pub permission_profile: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WaitRequest {
    pub child: AppThreadId,
    pub timeout: Duration,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SendRequest {
    pub child: AppThreadId,
    pub message: String,
    pub mode: SendMode,
}

/// One validated tool call.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ToolRequest {
    Delegate(DelegateRequest),
    WaitTask(TaskWaitRequest),
    CancelTask(TaskId),
    Spawn(SpawnRequest),
    Wait(WaitRequest),
    Send(SendRequest),
    Cancel(AppThreadId),
    List,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TaskWaitRequest {
    pub task_id: TaskId,
    pub timeout: Duration,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DelegateArguments {
    prompt: String,
    wait_mode: WaitMode,
    provider: Option<String>,
    model: Option<String>,
    name: Option<String>,
    permission_profile: Option<String>,
    workspace: WorkspaceArguments,
}

#[derive(Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum WorkspaceArguments {
    SharedReadOnly { cwd: Option<String> },
    IsolatedWrite { source_workspace: Option<String> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskWaitArguments {
    task_id: String,
    timeout_seconds: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TaskArguments {
    task_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SpawnArguments {
    prompt: String,
    provider: Option<String>,
    model: Option<String>,
    name: Option<String>,
    cwd: Option<String>,
    permission_profile: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WaitArguments {
    agent_thread_id: String,
    timeout_seconds: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SendArguments {
    agent_thread_id: String,
    message: String,
    #[serde(default)]
    mode: SendMode,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChildArguments {
    agent_thread_id: String,
}

fn decode<T: for<'de> Deserialize<'de>>(tool: &str, arguments: &Value) -> Result<T, String> {
    let arguments = if arguments.is_null() {
        json!({})
    } else {
        arguments.clone()
    };
    serde_json::from_value(arguments).map_err(|error| format!("invalid {tool} arguments: {error}"))
}

fn child(id: &str) -> Result<AppThreadId, String> {
    AppThreadId::parse(id).ok_or_else(|| "agentThreadId must be a non-empty thread id".to_owned())
}

fn task(id: &str) -> Result<TaskId, String> {
    TaskId::parse(id).ok_or_else(|| "taskId must be a UUIDv4 task id".to_owned())
}

fn timeout(seconds: Option<f64>) -> Result<Duration, String> {
    match seconds {
        None => Ok(DEFAULT_WAIT),
        Some(seconds) if seconds.is_finite() && seconds >= 0.0 => {
            Ok(Duration::from_secs_f64(seconds.min(MAX_WAIT.as_secs_f64())))
        }
        Some(_) => Err("timeoutSeconds must be a number from 0 to 300".into()),
    }
}

fn absolute_optional(value: Option<String>, label: &str) -> Result<Option<String>, String> {
    let value = present(value);
    if value
        .as_deref()
        .is_some_and(|path| !std::path::Path::new(path).is_absolute())
    {
        return Err(format!("{label} must be an absolute path"));
    }
    Ok(value)
}

/// Optional strings: empty means absent.
fn present(value: Option<String>) -> Option<String> {
    value.filter(|value| !value.trim().is_empty())
}

/// Decodes and validates one call's arguments.
///
/// # Errors
/// Returns the message the model sees for an unknown tool or invalid arguments.
pub fn parse(tool: &str, arguments: &Value) -> Result<ToolRequest, String> {
    match tool {
        DELEGATE_TASK => {
            let arguments: DelegateArguments = decode(tool, arguments)?;
            if arguments.prompt.trim().is_empty() {
                return Err("prompt must not be empty".into());
            }
            let provider = match present(arguments.provider) {
                Some(provider) => Some(
                    ProviderId::parse(&provider)
                        .ok_or_else(|| format!("unknown agent provider: {provider}"))?,
                ),
                None => None,
            };
            let workspace = match arguments.workspace {
                WorkspaceArguments::SharedReadOnly { cwd } => WorkspaceRequest::SharedReadOnly {
                    cwd: absolute_optional(cwd, "workspace.cwd")?,
                },
                WorkspaceArguments::IsolatedWrite { source_workspace } => {
                    WorkspaceRequest::IsolatedWrite {
                        source_workspace: absolute_optional(
                            source_workspace,
                            "workspace.sourceWorkspace",
                        )?,
                    }
                }
            };
            Ok(ToolRequest::Delegate(DelegateRequest {
                prompt: arguments.prompt,
                wait_mode: arguments.wait_mode,
                provider,
                model: present(arguments.model),
                name: present(arguments.name),
                permission_profile: present(arguments.permission_profile),
                workspace,
            }))
        }
        WAIT_TASK => {
            let arguments: TaskWaitArguments = decode(tool, arguments)?;
            Ok(ToolRequest::WaitTask(TaskWaitRequest {
                task_id: task(&arguments.task_id)?,
                timeout: timeout(arguments.timeout_seconds)?,
            }))
        }
        CANCEL_TASK => {
            let arguments: TaskArguments = decode(tool, arguments)?;
            Ok(ToolRequest::CancelTask(task(&arguments.task_id)?))
        }
        SPAWN_AGENT => {
            let arguments: SpawnArguments = decode(tool, arguments)?;
            if arguments.prompt.trim().is_empty() {
                return Err("prompt must not be empty".into());
            }
            let provider = match present(arguments.provider) {
                Some(provider) => Some(
                    ProviderId::parse(&provider)
                        .ok_or_else(|| format!("unknown agent provider: {provider}"))?,
                ),
                None => None,
            };
            let cwd = absolute_optional(arguments.cwd, "cwd")?;
            Ok(ToolRequest::Spawn(SpawnRequest {
                prompt: arguments.prompt,
                provider,
                model: present(arguments.model),
                name: present(arguments.name),
                cwd,
                permission_profile: present(arguments.permission_profile),
            }))
        }
        WAIT_AGENT => {
            let arguments: WaitArguments = decode(tool, arguments)?;
            Ok(ToolRequest::Wait(WaitRequest {
                child: child(&arguments.agent_thread_id)?,
                timeout: timeout(arguments.timeout_seconds)?,
            }))
        }
        SEND_AGENT => {
            let arguments: SendArguments = decode(tool, arguments)?;
            if arguments.message.trim().is_empty() {
                return Err("message must not be empty".into());
            }
            Ok(ToolRequest::Send(SendRequest {
                child: child(&arguments.agent_thread_id)?,
                message: arguments.message,
                mode: arguments.mode,
            }))
        }
        CANCEL_AGENT => {
            let arguments: ChildArguments = decode(tool, arguments)?;
            Ok(ToolRequest::Cancel(child(&arguments.agent_thread_id)?))
        }
        LIST_AGENTS => Ok(ToolRequest::List),
        other => Err(format!("unknown tool: {other}")),
    }
}

/// An agent's status as the tools report it.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentStatus {
    Running,
    Completed,
    Failed,
    Interrupted,
}

/// The outcome of `codewide_send_agent`.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SendStatus {
    /// A new turn started, or the running turn took the message (steer).
    Running,
    /// The message waits for the running turn to end.
    Queued,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnResult {
    pub agent_thread_id: String,
    pub provider: String,
    pub model: String,
    pub status: AgentStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaitResult {
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct SendResult {
    pub status: SendStatus,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub struct CancelResult {
    pub status: AgentStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListedAgent {
    pub agent_thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub provider: String,
    pub model: String,
    pub name: Option<String>,
    /// `null` when the agent's provider cannot report it right now.
    pub status: Option<AgentStatus>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct ListResult {
    pub agents: Vec<ListedAgent>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_declares_an_object_schema_and_unknown_tools_fail() {
        let specs = specs();
        let names = specs
            .iter()
            .map(|spec| spec.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            [
                DELEGATE_TASK,
                WAIT_TASK,
                CANCEL_TASK,
                SPAWN_AGENT,
                WAIT_AGENT,
                SEND_AGENT,
                CANCEL_AGENT,
                LIST_AGENTS
            ]
        );
        assert!(
            specs
                .iter()
                .all(|spec| spec.input_schema["type"] == "object")
        );
        assert!(parse("codewide_other", &json!({})).is_err());
    }

    #[test]
    fn arguments_are_validated_with_contract_defaults() -> Result<(), String> {
        assert_eq!(
            parse(WAIT_AGENT, &json!({"agentThreadId": "c"}))?,
            ToolRequest::Wait(WaitRequest {
                child: AppThreadId::from_static("c"),
                timeout: DEFAULT_WAIT
            })
        );
        assert_eq!(
            parse(
                WAIT_AGENT,
                &json!({"agentThreadId": "c", "timeoutSeconds": 9000})
            )?,
            ToolRequest::Wait(WaitRequest {
                child: AppThreadId::from_static("c"),
                timeout: MAX_WAIT
            })
        );
        assert!(
            parse(
                WAIT_AGENT,
                &json!({"agentThreadId": "c", "timeoutSeconds": -1})
            )
            .is_err()
        );
        assert_eq!(
            parse(SEND_AGENT, &json!({"agentThreadId": "c", "message": "m"}))?,
            ToolRequest::Send(SendRequest {
                child: AppThreadId::from_static("c"),
                message: "m".into(),
                mode: SendMode::Queue
            })
        );
        assert!(
            parse(
                SEND_AGENT,
                &json!({"agentThreadId": "c", "message": "m", "mode": "now"})
            )
            .is_err()
        );
        assert!(parse(SPAWN_AGENT, &json!({"prompt": " "})).is_err());
        assert!(parse(SPAWN_AGENT, &json!({"prompt": "p", "cwd": "rel"})).is_err());
        assert_eq!(parse(LIST_AGENTS, &Value::Null)?, ToolRequest::List);
        Ok(())
    }

    #[test]
    fn results_serialize_to_the_contract_shape() -> Result<(), serde_json::Error> {
        assert_eq!(
            serde_json::to_value(WaitResult {
                status: AgentStatus::Running,
                final_message: None,
                turn_id: None
            })?,
            json!({"status": "running"})
        );
        assert_eq!(
            serde_json::to_value(SpawnResult {
                agent_thread_id: "c".into(),
                provider: "claude".into(),
                model: "m".into(),
                status: AgentStatus::Running
            })?,
            json!({"agentThreadId": "c", "provider": "claude", "model": "m", "status": "running"})
        );
        Ok(())
    }
}
