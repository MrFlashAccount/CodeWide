use std::{
    collections::HashMap,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tokio::sync::{Mutex, watch};

use crate::vcs::{VcsError, VcsService, WorkspaceCreateResult};

const OPERATION_FILE: &str = ".codewide-workspace-operation.json";

#[derive(Clone)]
pub struct WorkspaceService {
    vcs: Arc<VcsService>,
    storage_root: PathBuf,
    operations: Arc<Mutex<HashMap<String, watch::Sender<WorkspaceOperation>>>>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WorkspacePhase {
    Creating,
    Preparing,
    Ready,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOperation {
    pub request_id: String,
    pub phase: WorkspacePhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<WorkspaceCreateResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub updated_at: u64,
}

#[derive(Debug, Error)]
pub enum WorkspaceError {
    #[error("invalid workspace request: {0}")]
    InvalidRequest(String),
    #[error("workspace operation failed: {0}")]
    OperationFailed(String),
    #[error("workspace operation was not found: {0}")]
    OperationNotFound(String),
    #[error("workspace operation storage failed: {0}")]
    Storage(String),
    #[error(transparent)]
    Vcs(#[from] VcsError),
}

impl WorkspaceService {
    #[must_use]
    pub fn new(vcs: Arc<VcsService>, storage_root: PathBuf) -> Self {
        Self {
            vcs,
            storage_root,
            operations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        matches!(
            method,
            "companion/workspace/inspect"
                | "companion/workspace/create"
                | "companion/workspace/read"
        )
    }

    /// Handles the application-level workspace lifecycle contract.
    ///
    /// `create` returns as soon as the provider has materialized a usable cwd.
    /// Provider preparation may continue in the background; durable turn
    /// delivery remains gated by [`Self::operation_status`] until `ready`.
    ///
    /// # Errors
    ///
    /// Returns validation, storage, or provider errors.
    pub async fn handle(&self, method: &str, params: &Value) -> Result<Value, WorkspaceError> {
        match method {
            "companion/workspace/inspect" => {
                let workspace = required_absolute_path(params, "workspace")?;
                Ok(json!({
                    "support": self.vcs.workspace_support(&workspace).await?,
                }))
            }
            "companion/workspace/create" => {
                let workspace = required_absolute_path(params, "workspace")?;
                let request_id = required_request_id(params)?;
                let operation = self
                    .start_or_observe(workspace, request_id.to_owned())
                    .await?;
                if operation.phase == WorkspacePhase::Failed {
                    return Err(WorkspaceError::OperationFailed(
                        operation
                            .error
                            .unwrap_or_else(|| "unknown provider failure".into()),
                    ));
                }
                Ok(json!({
                    "workspace": operation.workspace,
                    "operation": operation,
                }))
            }
            "companion/workspace/read" => {
                let request_id = required_request_id(params)?;
                let operation = self
                    .operation_status(request_id)
                    .await?
                    .ok_or_else(|| WorkspaceError::OperationNotFound(request_id.to_owned()))?;
                Ok(json!({ "operation": operation }))
            }
            _ => Err(WorkspaceError::InvalidRequest(format!(
                "unsupported method {method}"
            ))),
        }
    }

    /// Reads the latest lifecycle phase from the live operation registry or
    /// its durable checkpoint. In-flight checkpoints from a previous companion
    /// process are terminally failed: running a turn after an interrupted hook
    /// would violate the workspace readiness invariant.
    ///
    /// # Errors
    ///
    /// Returns an error for an invalid request id or unreadable lifecycle
    /// checkpoint.
    pub async fn operation_status(
        &self,
        request_id: &str,
    ) -> Result<Option<WorkspaceOperation>, WorkspaceError> {
        validate_request_id(request_id)?;
        if let Some(operation) = self.live_operation(request_id).await {
            return Ok(Some(operation));
        }
        let Some(mut operation) = self.read_operation(request_id).await? else {
            return Ok(None);
        };
        if matches!(
            operation.phase,
            WorkspacePhase::Creating | WorkspacePhase::Preparing
        ) {
            operation.phase = WorkspacePhase::Failed;
            operation.error =
                Some("workspace preparation was interrupted by companion restart".into());
            operation.updated_at = unix_time_ms();
            self.persist_operation(&operation).await?;
        }
        Ok(Some(operation))
    }

    async fn start_or_observe(
        &self,
        workspace: PathBuf,
        request_id: String,
    ) -> Result<WorkspaceOperation, WorkspaceError> {
        validate_request_id(&request_id)?;
        let mut receiver = {
            let mut operations = self.operations.lock().await;
            if let Some(sender) = operations.get(&request_id) {
                sender.subscribe()
            } else if let Some(operation) = self.read_operation(&request_id).await? {
                if matches!(
                    operation.phase,
                    WorkspacePhase::Ready | WorkspacePhase::Failed
                ) {
                    return Ok(operation);
                }
                let failed = WorkspaceOperation {
                    phase: WorkspacePhase::Failed,
                    error: Some(
                        "workspace preparation was interrupted by companion restart".into(),
                    ),
                    updated_at: unix_time_ms(),
                    ..operation
                };
                self.persist_operation(&failed).await?;
                return Ok(failed);
            } else {
                let initial = WorkspaceOperation {
                    request_id: request_id.clone(),
                    phase: WorkspacePhase::Creating,
                    workspace: None,
                    error: None,
                    updated_at: unix_time_ms(),
                };
                self.persist_operation(&initial).await?;
                let (sender, receiver) = watch::channel(initial);
                operations.insert(request_id.clone(), sender.clone());
                self.spawn_creation(workspace, request_id, sender);
                receiver
            }
        };

        loop {
            let operation = receiver.borrow().clone();
            if operation.phase != WorkspacePhase::Creating {
                return Ok(operation);
            }
            receiver.changed().await.map_err(|_| {
                WorkspaceError::OperationFailed("workspace operation stopped unexpectedly".into())
            })?;
        }
    }

    fn spawn_creation(
        &self,
        workspace: PathBuf,
        request_id: String,
        state: watch::Sender<WorkspaceOperation>,
    ) {
        let service = self.clone();
        tokio::spawn(async move {
            let (progress_tx, mut progress_rx) = tokio::sync::mpsc::unbounded_channel();
            let creation = service.vcs.create_workspace_with_progress(
                &workspace,
                &request_id,
                &service.storage_root,
                progress_tx,
            );
            tokio::pin!(creation);
            let mut progress_open = true;
            let mut checkpoint_failed = false;
            loop {
                tokio::select! {
                    progress = progress_rx.recv(), if progress_open => {
                        match progress {
                            Some(workspace) => {
                                let operation = WorkspaceOperation {
                                    request_id: request_id.clone(),
                                    phase: WorkspacePhase::Preparing,
                                    workspace: Some(workspace),
                                    error: None,
                                    updated_at: unix_time_ms(),
                                };
                                checkpoint_failed |= !service.publish_operation(&state, operation).await;
                            }
                            None => progress_open = false,
                        }
                    }
                    result = &mut creation => {
                        if checkpoint_failed {
                            service.operations.lock().await.remove(&request_id);
                            break;
                        }
                        let operation = match result {
                            Ok(workspace) => WorkspaceOperation {
                                request_id: request_id.clone(),
                                phase: WorkspacePhase::Ready,
                                workspace: Some(workspace),
                                error: None,
                                updated_at: unix_time_ms(),
                            },
                            Err(error) => WorkspaceOperation {
                                request_id: request_id.clone(),
                                phase: WorkspacePhase::Failed,
                                workspace: state.borrow().workspace.clone(),
                                error: Some(error.to_string()),
                                updated_at: unix_time_ms(),
                            },
                        };
                        let _ = service.publish_operation(&state, operation).await;
                        service.operations.lock().await.remove(&request_id);
                        break;
                    }
                }
            }
        });
    }

    async fn publish_operation(
        &self,
        state: &watch::Sender<WorkspaceOperation>,
        operation: WorkspaceOperation,
    ) -> bool {
        if let Err(error) = self.persist_operation(&operation).await {
            let failed = WorkspaceOperation {
                phase: WorkspacePhase::Failed,
                error: Some(error.to_string()),
                updated_at: unix_time_ms(),
                ..operation
            };
            let _ = state.send(failed);
            return false;
        }
        let _ = state.send(operation);
        true
    }

    async fn live_operation(&self, request_id: &str) -> Option<WorkspaceOperation> {
        self.operations
            .lock()
            .await
            .get(request_id)
            .map(|sender| sender.borrow().clone())
    }

    async fn read_operation(
        &self,
        request_id: &str,
    ) -> Result<Option<WorkspaceOperation>, WorkspaceError> {
        let path = self.operation_path(request_id);
        match tokio::fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|error| {
                WorkspaceError::Storage(format!("could not parse {}: {error}", path.display()))
            }),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(WorkspaceError::Storage(format!(
                "could not read {}: {error}",
                path.display()
            ))),
        }
    }

    async fn persist_operation(
        &self,
        operation: &WorkspaceOperation,
    ) -> Result<(), WorkspaceError> {
        let path = self.operation_path(&operation.request_id);
        let parent = path.parent().ok_or_else(|| {
            WorkspaceError::Storage("workspace operation path has no parent".into())
        })?;
        tokio::fs::create_dir_all(parent).await.map_err(|error| {
            WorkspaceError::Storage(format!("could not create {}: {error}", parent.display()))
        })?;
        let temporary = parent.join(format!(".{OPERATION_FILE}.{}.tmp", std::process::id()));
        let mut bytes = serde_json::to_vec_pretty(operation)
            .map_err(|error| WorkspaceError::Storage(error.to_string()))?;
        bytes.push(b'\n');
        tokio::fs::write(&temporary, bytes).await.map_err(|error| {
            WorkspaceError::Storage(format!("could not write {}: {error}", temporary.display()))
        })?;
        tokio::fs::rename(&temporary, &path).await.map_err(|error| {
            WorkspaceError::Storage(format!("could not replace {}: {error}", path.display()))
        })
    }

    fn operation_path(&self, request_id: &str) -> PathBuf {
        self.storage_root.join(request_id).join(OPERATION_FILE)
    }
}

fn required_absolute_path(params: &Value, name: &str) -> Result<PathBuf, WorkspaceError> {
    let path = params
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| WorkspaceError::InvalidRequest(format!("{name} is required")))?;
    if !path.is_absolute() {
        return Err(WorkspaceError::InvalidRequest(format!(
            "{name} must be an absolute path"
        )));
    }
    Ok(path)
}

fn required_request_id(params: &Value) -> Result<&str, WorkspaceError> {
    let request_id = params
        .get("requestId")
        .and_then(Value::as_str)
        .ok_or_else(|| WorkspaceError::InvalidRequest("requestId is required".into()))?;
    validate_request_id(request_id)?;
    Ok(request_id)
}

fn validate_request_id(request_id: &str) -> Result<(), WorkspaceError> {
    if !request_id.is_empty()
        && request_id.len() <= 128
        && request_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(())
    } else {
        Err(WorkspaceError::InvalidRequest(
            "requestId must be a safe token".into(),
        ))
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owns_workspace_lifecycle_methods() {
        assert!(WorkspaceService::handles("companion/workspace/inspect"));
        assert!(WorkspaceService::handles("companion/workspace/create"));
        assert!(WorkspaceService::handles("companion/workspace/read"));
        assert!(!WorkspaceService::handles("workspace.create"));
    }

    #[test]
    fn rejects_relative_workspace_paths() {
        let error = match required_absolute_path(&json!({ "workspace": "relative" }), "workspace") {
            Ok(path) => panic!("relative path unexpectedly accepted: {}", path.display()),
            Err(error) => error,
        };
        assert_eq!(
            error.to_string(),
            "invalid workspace request: workspace must be an absolute path"
        );
    }

    #[test]
    fn rejects_request_id_path_traversal() {
        assert!(validate_request_id("safe-request_1").is_ok());
        assert!(validate_request_id("../unsafe").is_err());
    }

    #[tokio::test]
    async fn terminal_operation_rehydrates_without_retaining_a_live_sender()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let service = WorkspaceService::new(
            Arc::new(VcsService::new(directory.path().join("plugins.json"))),
            directory.path().join("workspaces"),
        );
        let workspace = WorkspaceCreateResult {
            capability: crate::vcs::WORKSPACE_CREATE_CAPABILITY.into(),
            provider: "arc".into(),
            repository_root: PathBuf::from("/workspace"),
            cwd: PathBuf::from("/workspace/project"),
            created: true,
        };
        service
            .persist_operation(&WorkspaceOperation {
                request_id: "request-1".into(),
                phase: WorkspacePhase::Ready,
                workspace: Some(workspace),
                error: None,
                updated_at: 1,
            })
            .await?;

        let operation = service
            .start_or_observe(PathBuf::from("/source"), "request-1".into())
            .await?;
        assert_eq!(operation.phase, WorkspacePhase::Ready);
        assert!(service.operations.lock().await.is_empty());
        Ok(())
    }

    #[tokio::test]
    async fn persisted_preparing_operation_fails_closed_after_restart()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let service = WorkspaceService::new(
            Arc::new(VcsService::new(directory.path().join("plugins.json"))),
            directory.path().join("workspaces"),
        );
        service
            .persist_operation(&WorkspaceOperation {
                request_id: "request-2".into(),
                phase: WorkspacePhase::Preparing,
                workspace: None,
                error: None,
                updated_at: 1,
            })
            .await?;

        let operation = service
            .operation_status("request-2")
            .await?
            .ok_or("operation does not exist")?;
        assert_eq!(operation.phase, WorkspacePhase::Failed);
        assert_eq!(
            operation.error.as_deref(),
            Some("workspace preparation was interrupted by companion restart")
        );
        Ok(())
    }
}
