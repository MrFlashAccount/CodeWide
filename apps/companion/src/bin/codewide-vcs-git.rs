use std::{
    io::{BufRead, Write},
    path::{Path, PathBuf},
};

use codewide_companion::vcs::{
    CHANGES_CAPABILITY, DIFF_CAPABILITY, DIFF_PAGE_CAPABILITY, GitProvider, VcsError, VcsFile,
    VcsScope, VcsSnapshot, WORKSPACE_CREATE_CAPABILITY, WorkspaceCreateResult, WorkspaceSupport,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const PROTOCOL_VERSION: u32 = 1;
const MAX_FRAME_BYTES: usize = 32 * 1024 * 1024;
const WORKSPACE_NOT_OWNED: i64 = -32_004;

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = std::io::stdin();
    let mut reader = stdin.lock();
    let stdout = std::io::stdout();
    let mut writer = stdout.lock();
    while let Some(payload) = read_frame(&mut reader)? {
        let request = serde_json::from_slice::<Request>(&payload)?;
        let response = dispatch(request).await;
        write_frame(&mut writer, &serde_json::to_vec(&response)?)?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct Request {
    jsonrpc: String,
    id: Value,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    jsonrpc: &'static str,
    id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ResponseError>,
}

#[derive(Debug, Serialize)]
struct ResponseError {
    code: i64,
    message: String,
}

async fn dispatch(request: Request) -> Response {
    if request.jsonrpc != "2.0" {
        return failure(request.id, -32_600, "invalid JSON-RPC version");
    }
    let result = match request.method.as_str() {
        "initialize" => initialize(&request.params),
        "vcs.changes" => changes_request(&request.params).await,
        "vcs.diff" => diff_request(&request.params).await,
        "vcs.diffPage" => diff_page_request(&request.params).await,
        "workspace.inspect" => workspace_inspect_request(&request.params).await,
        "workspace.create" => workspace_create_request(&request.params).await,
        _ => Err(ProviderError::MethodNotFound(request.method)),
    };
    match result {
        Ok(result) => Response {
            jsonrpc: "2.0",
            id: request.id,
            result: Some(result),
            error: None,
        },
        Err(ProviderError::Vcs(VcsError::UnsupportedWorkspace(_))) => failure(
            request.id,
            WORKSPACE_NOT_OWNED,
            "workspace is not owned by Git",
        ),
        Err(ProviderError::MethodNotFound(method)) => {
            failure(request.id, -32_601, &format!("method not found: {method}"))
        }
        Err(error) => failure(request.id, -32_000, &error.to_string()),
    }
}

fn failure(id: Value, code: i64, message: &str) -> Response {
    Response {
        jsonrpc: "2.0",
        id,
        result: None,
        error: Some(ResponseError {
            code,
            message: message.to_owned(),
        }),
    }
}

fn initialize(params: &Value) -> Result<Value, ProviderError> {
    let version = params
        .get("protocolVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| ProviderError::Protocol("protocolVersion is required".into()))?;
    if version != u64::from(PROTOCOL_VERSION) {
        return Err(ProviderError::Protocol(format!(
            "unsupported protocol version {version}"
        )));
    }
    Ok(json!({
        "protocolVersion": PROTOCOL_VERSION,
        "provider": "git",
        "displayName": "Git",
        "version": env!("CARGO_PKG_VERSION"),
        "capabilities": [
            CHANGES_CAPABILITY,
            DIFF_CAPABILITY,
            DIFF_PAGE_CAPABILITY,
            WORKSPACE_CREATE_CAPABILITY
        ]
    }))
}

async fn changes_request(params: &Value) -> Result<Value, ProviderError> {
    let workspace = required_absolute_path(params, "workspace")?;
    let scope = change_scope(params)?;
    serde_json::to_value(GitProvider.changes(&workspace, scope).await?)
        .map_err(|error| ProviderError::Protocol(error.to_string()))
}

async fn diff_request(params: &Value) -> Result<Value, ProviderError> {
    let workspace = required_absolute_path(params, "workspace")?;
    let path = required_absolute_path(params, "path")?;
    let scope = change_scope(params)?;
    let snapshot = GitProvider.changes(&workspace, scope).await?;
    let file = find_snapshot_file(&snapshot, &path)
        .ok_or_else(|| VcsError::FileNotChanged(path.clone()))?;
    serde_json::to_value(GitProvider.diff(&snapshot, file).await?)
        .map_err(|error| ProviderError::Protocol(error.to_string()))
}

async fn diff_page_request(params: &Value) -> Result<Value, ProviderError> {
    let workspace = required_absolute_path(params, "workspace")?;
    let path = required_absolute_path(params, "path")?;
    let scope = change_scope(params)?;
    let offset = required_usize(params, "offset")?;
    let limit = required_usize(params, "limit")?;
    let snapshot = GitProvider.changes(&workspace, scope).await?;
    let requested_snapshot = required_token(params, "snapshotId")?;
    if snapshot.snapshot_id != requested_snapshot {
        return Err(ProviderError::Protocol(
            "snapshot changed before the diff page could be read".into(),
        ));
    }
    let file = find_snapshot_file(&snapshot, &path)
        .ok_or_else(|| VcsError::FileNotChanged(path.clone()))?;
    serde_json::to_value(
        GitProvider
            .diff_page(&snapshot, file, offset, limit)
            .await?,
    )
    .map_err(|error| ProviderError::Protocol(error.to_string()))
}

async fn workspace_inspect_request(params: &Value) -> Result<Value, ProviderError> {
    let workspace = required_absolute_path(params, "workspace")?;
    let root = GitProvider
        .detect(&workspace)
        .await?
        .ok_or(VcsError::UnsupportedWorkspace(workspace))?;
    serde_json::to_value(WorkspaceSupport {
        capability: WORKSPACE_CREATE_CAPABILITY.into(),
        provider: "git".into(),
        display_name: "Git worktree".into(),
        repository_root: root,
    })
    .map_err(|error| ProviderError::Protocol(error.to_string()))
}

async fn workspace_create_request(params: &Value) -> Result<Value, ProviderError> {
    let workspace = required_absolute_path(params, "workspace")?;
    let storage_root = required_absolute_path(params, "storageRoot")?;
    let request_id = required_token(params, "requestId")?;
    let root = GitProvider
        .detect(&workspace)
        .await?
        .ok_or_else(|| VcsError::UnsupportedWorkspace(workspace.clone()))?;
    let canonical_workspace = workspace.canonicalize().map_err(|error| {
        ProviderError::Protocol(format!("could not resolve selected workspace: {error}"))
    })?;
    let canonical_root = root.canonicalize().map_err(|error| {
        ProviderError::Protocol(format!("could not resolve Git repository root: {error}"))
    })?;
    let relative_cwd = canonical_workspace
        .strip_prefix(&canonical_root)
        .map_err(|_| {
            ProviderError::Protocol("workspace is outside the detected Git repository".into())
        })?;
    let repository_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("workspace");
    let destination = storage_root.join(request_id).join(repository_name);
    let created = if destination.exists() {
        if git_common_dir(&root).await? != git_common_dir(&destination).await? {
            return Err(ProviderError::Protocol(format!(
                "workspace destination belongs to another repository: {}",
                destination.display()
            )));
        }
        false
    } else {
        let parent = destination
            .parent()
            .ok_or_else(|| ProviderError::Protocol("workspace destination has no parent".into()))?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| ProviderError::Protocol(error.to_string()))?;
        let output = tokio::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(["worktree", "add", "--detach"])
            .arg(&destination)
            .arg("HEAD")
            .output()
            .await
            .map_err(|error| {
                ProviderError::Protocol(format!("could not start git worktree: {error}"))
            })?;
        if !output.status.success() {
            return Err(ProviderError::Protocol(command_failure(
                "git worktree add",
                &output.stderr,
            )));
        }
        true
    };
    let cwd = destination.join(relative_cwd);
    if !cwd.is_dir() {
        return Err(ProviderError::Protocol(format!(
            "created workspace does not contain the selected directory: {}",
            cwd.display()
        )));
    }
    serde_json::to_value(WorkspaceCreateResult {
        capability: WORKSPACE_CREATE_CAPABILITY.into(),
        provider: "git".into(),
        repository_root: destination,
        cwd,
        created,
    })
    .map_err(|error| ProviderError::Protocol(error.to_string()))
}

async fn git_common_dir(workspace: &Path) -> Result<PathBuf, ProviderError> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(workspace)
        .args(["rev-parse", "--path-format=absolute", "--git-common-dir"])
        .output()
        .await
        .map_err(|error| {
            ProviderError::Protocol(format!("could not start git rev-parse: {error}"))
        })?;
    if !output.status.success() {
        return Err(ProviderError::Protocol(command_failure(
            "git rev-parse --git-common-dir",
            &output.stderr,
        )));
    }
    let path = String::from_utf8(output.stdout)
        .map_err(|_| ProviderError::Protocol("Git returned a non-UTF-8 common directory".into()))?;
    let path = PathBuf::from(path.trim());
    path.canonicalize().map_err(|error| {
        ProviderError::Protocol(format!("could not resolve Git common directory: {error}"))
    })
}

fn command_failure(operation: &str, stderr: &[u8]) -> String {
    let detail = String::from_utf8_lossy(stderr).trim().to_owned();
    if detail.is_empty() {
        operation.to_owned()
    } else {
        format!("{operation}: {detail}")
    }
}

fn change_scope(params: &Value) -> Result<VcsScope, ProviderError> {
    serde_json::from_value(
        params
            .get("scope")
            .cloned()
            .unwrap_or_else(|| json!("branch")),
    )
    .map_err(|error| ProviderError::Protocol(format!("invalid change scope: {error}")))
}

fn required_absolute_path(params: &Value, name: &str) -> Result<PathBuf, ProviderError> {
    let path = params
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| ProviderError::Protocol(format!("{name} is required")))?;
    if !path.is_absolute() {
        return Err(ProviderError::Protocol(format!(
            "{name} must be an absolute path"
        )));
    }
    Ok(path)
}

fn required_token<'a>(params: &'a Value, name: &str) -> Result<&'a str, ProviderError> {
    let value = params
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        .ok_or_else(|| ProviderError::Protocol(format!("{name} is invalid")))?;
    Ok(value)
}

fn required_usize(params: &Value, name: &str) -> Result<usize, ProviderError> {
    params
        .get(name)
        .and_then(Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| ProviderError::Protocol(format!("{name} is invalid")))
}

fn find_snapshot_file<'a>(snapshot: &'a VcsSnapshot, path: &Path) -> Option<&'a VcsFile> {
    if let Some(file) = snapshot.files.iter().find(|file| file.path == path) {
        return Some(file);
    }
    let canonical = path.canonicalize().ok()?;
    snapshot.files.iter().find(|file| {
        file.path
            .canonicalize()
            .is_ok_and(|candidate| candidate == canonical)
    })
}

#[derive(Debug, thiserror::Error)]
enum ProviderError {
    #[error(transparent)]
    Vcs(#[from] VcsError),
    #[error("plugin protocol error: {0}")]
    Protocol(String),
    #[error("method not found: {0}")]
    MethodNotFound(String),
}

fn read_frame(reader: &mut impl BufRead) -> Result<Option<Vec<u8>>, Box<dyn std::error::Error>> {
    let mut content_length = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        let (name, value) = line
            .trim_end_matches(['\r', '\n'])
            .split_once(':')
            .ok_or("malformed frame header")?;
        if name.eq_ignore_ascii_case("Content-Length") {
            content_length = Some(value.trim().parse::<usize>()?);
        }
    }
    let length = content_length.ok_or("missing Content-Length header")?;
    if length > MAX_FRAME_BYTES {
        return Err("frame is too large".into());
    }
    let mut payload = vec![0; length];
    reader.read_exact(&mut payload)?;
    Ok(Some(payload))
}

fn write_frame(writer: &mut impl Write, payload: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
    if payload.len() > MAX_FRAME_BYTES {
        return Err("frame is too large".into());
    }
    write!(writer, "Content-Length: {}\r\n\r\n", payload.len())?;
    writer.write_all(payload)?;
    writer.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advertises_the_git_provider_contract() {
        let value = initialize(&json!({ "protocolVersion": 1 })).unwrap_or(Value::Null);
        assert_eq!(value["provider"], "git");
        assert_eq!(
            value["capabilities"],
            json!([
                CHANGES_CAPABILITY,
                DIFF_CAPABILITY,
                WORKSPACE_CREATE_CAPABILITY
            ])
        );
    }

    #[test]
    fn validates_workspace_request_ids() {
        assert_eq!(
            required_token(&json!({ "requestId": "new-chat_12" }), "requestId").ok(),
            Some("new-chat_12")
        );
        assert!(required_token(&json!({ "requestId": "../escape" }), "requestId").is_err());
    }
}
