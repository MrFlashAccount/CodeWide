use std::{
    collections::HashMap,
    io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
    sync::Mutex,
};

const PROJECT_REGISTRY_VERSION: u8 = 1;

#[derive(Clone)]
pub struct ProjectService {
    state_path: PathBuf,
    state: std::sync::Arc<Mutex<ProjectRegistry>>,
    observed: std::sync::Arc<Mutex<HashMap<String, Project>>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub path: String,
    pub name: String,
    pub added_at: u64,
    pub last_used_at: u64,
    #[serde(default = "default_pinned")]
    pub pinned: bool,
}

const fn default_pinned() -> bool {
    true
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRegistry {
    version: u8,
    projects: Vec<Project>,
}

#[derive(Debug, Error)]
pub enum ProjectError {
    #[error("invalid project request: {0}")]
    InvalidRequest(String),
    #[error("project directory is unavailable: {0}")]
    InvalidDirectory(String),
    #[error("project registry storage failed: {0}")]
    Storage(#[from] io::Error),
    #[error("project registry is invalid")]
    Corrupted,
}

impl ProjectService {
    /// Opens the companion-owned project registry.
    ///
    /// # Errors
    ///
    /// Returns an error when the registry cannot be read or initialized.
    pub async fn open(state_path: PathBuf) -> Result<std::sync::Arc<Self>, ProjectError> {
        let state = load_registry(&state_path).await?;
        if let Some(parent) = state_path.parent() {
            fs::create_dir_all(parent).await?;
            fs::set_permissions(parent, std::fs::Permissions::from_mode(0o700)).await?;
        }
        Ok(std::sync::Arc::new(Self {
            state_path,
            state: std::sync::Arc::new(Mutex::new(state)),
            observed: std::sync::Arc::new(Mutex::new(HashMap::new())),
        }))
    }

    #[must_use]
    pub fn handles(method: &str) -> bool {
        matches!(method, "companion/project/list" | "companion/project/add")
    }

    /// Handles one project-registry RPC.
    ///
    /// # Errors
    ///
    /// Returns validation or durable-storage failures to the caller.
    pub async fn handle(&self, method: &str, params: &Value) -> Result<Value, ProjectError> {
        match method {
            "companion/project/list" => Ok(json!({ "data": self.list().await })),
            "companion/project/add" => {
                let path = params
                    .get("path")
                    .and_then(Value::as_str)
                    .ok_or_else(|| ProjectError::InvalidRequest("path is required".into()))?;
                Ok(json!({ "project": self.add(path).await? }))
            }
            _ => Err(ProjectError::InvalidRequest(format!(
                "unsupported method {method}"
            ))),
        }
    }

    async fn list(&self) -> Vec<Project> {
        let mut projects = self.state.lock().await.projects.clone();
        let observed = self.observed.lock().await;
        for candidate in observed.values() {
            if let Some(explicit) = projects
                .iter_mut()
                .find(|project| project.path == candidate.path)
            {
                explicit.last_used_at = explicit.last_used_at.max(candidate.last_used_at);
            } else {
                projects.push(candidate.clone());
            }
        }
        projects.sort_by(|left, right| {
            right
                .last_used_at
                .cmp(&left.last_used_at)
                .then_with(|| left.name.cmp(&right.name))
        });
        projects
    }

    /// Observes authoritative App Server thread results and keeps the project
    /// catalog on the companion. Paths are the sole identity: the client must
    /// not reconstruct projects or disambiguate labels from thread history.
    pub async fn observe_rpc_result(&self, method: &str, result: &Value) {
        let threads: Vec<&Value> = match method {
            "thread/list" => result
                .get("data")
                .and_then(Value::as_array)
                .map_or_else(Vec::new, |items| items.iter().collect()),
            "thread/start" | "thread/resume" | "thread/fork" => {
                result.get("thread").into_iter().collect()
            }
            _ => return,
        };
        if threads.is_empty() {
            return;
        }
        let mut observed = self.observed.lock().await;
        for thread in threads {
            let Some(project) = project_from_thread(thread) else {
                continue;
            };
            match observed.get_mut(&project.path) {
                Some(existing) => {
                    existing.last_used_at = existing.last_used_at.max(project.last_used_at);
                }
                None => {
                    observed.insert(project.path.clone(), project);
                }
            }
        }
    }

    async fn add(&self, raw_path: &str) -> Result<Project, ProjectError> {
        let requested = Path::new(raw_path.trim());
        if raw_path.contains('\0') || !requested.is_absolute() {
            return Err(ProjectError::InvalidRequest(
                "path must be an absolute directory".into(),
            ));
        }
        let canonical = fs::canonicalize(requested)
            .await
            .map_err(|error| ProjectError::InvalidDirectory(error.to_string()))?;
        let metadata = fs::metadata(&canonical)
            .await
            .map_err(|error| ProjectError::InvalidDirectory(error.to_string()))?;
        if !metadata.is_dir() {
            return Err(ProjectError::InvalidDirectory(
                "selected path is not a directory".into(),
            ));
        }
        let path = canonical
            .to_str()
            .ok_or_else(|| ProjectError::InvalidDirectory("path is not valid UTF-8".into()))?
            .to_owned();
        let name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or(path.as_str())
            .to_owned();
        let now = unix_time_ms();
        let mut state = self.state.lock().await;
        if let Some(existing) = state
            .projects
            .iter_mut()
            .find(|project| project.path == path)
        {
            existing.last_used_at = now;
        } else {
            state.projects.push(Project {
                path: path.clone(),
                name,
                added_at: now,
                last_used_at: now,
                pinned: true,
            });
        }
        persist_registry(&self.state_path, &state).await?;
        state
            .projects
            .iter()
            .find(|project| project.path == path)
            .cloned()
            .ok_or(ProjectError::Corrupted)
    }
}

fn project_from_thread(thread: &Value) -> Option<Project> {
    let raw_path = thread.get("cwd")?.as_str()?.trim();
    if raw_path.is_empty() || !Path::new(raw_path).is_absolute() {
        return None;
    }
    let path = if raw_path == "/" {
        "/".to_owned()
    } else {
        raw_path.trim_end_matches('/').to_owned()
    };
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(path.as_str())
        .to_owned();
    let last_used_at = thread
        .get("recencyAt")
        .or_else(|| thread.get("updatedAt"))
        .and_then(Value::as_u64)
        .unwrap_or_default();
    Some(Project {
        path,
        name,
        added_at: last_used_at,
        last_used_at,
        pinned: false,
    })
}

async fn load_registry(path: &Path) -> Result<ProjectRegistry, ProjectError> {
    let raw = match fs::read(path).await {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(ProjectRegistry {
                version: PROJECT_REGISTRY_VERSION,
                projects: Vec::new(),
            });
        }
        Err(error) => return Err(error.into()),
    };
    let registry: ProjectRegistry =
        serde_json::from_slice(&raw).map_err(|_| ProjectError::Corrupted)?;
    if registry.version != PROJECT_REGISTRY_VERSION {
        return Err(ProjectError::Corrupted);
    }
    Ok(registry)
}

async fn persist_registry(path: &Path, registry: &ProjectRegistry) -> Result<(), ProjectError> {
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec_pretty(registry).map_err(|_| ProjectError::Corrupted)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&temporary)
        .await?;
    file.write_all(&bytes).await?;
    file.write_all(b"\n").await?;
    file.sync_all().await?;
    fs::rename(temporary, path).await?;
    Ok(())
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

    #[tokio::test]
    async fn adds_deduplicates_and_persists_projects() -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let directory = temp.path().join("my-project");
        fs::create_dir(&directory).await?;
        let registry_path = temp.path().join("state/projects.json");
        let service = ProjectService::open(registry_path.clone()).await?;

        let first = service
            .handle(
                "companion/project/add",
                &json!({ "path": directory.to_string_lossy() }),
            )
            .await?;
        let second = service
            .handle(
                "companion/project/add",
                &json!({ "path": directory.to_string_lossy() }),
            )
            .await?;

        assert_eq!(first["project"]["name"], "my-project");
        assert_eq!(second["project"]["path"], first["project"]["path"]);
        let reopened = ProjectService::open(registry_path).await?;
        let listed = reopened
            .handle("companion/project/list", &json!({}))
            .await?;
        assert_eq!(listed["data"].as_array().map(Vec::len), Some(1));
        Ok(())
    }

    #[tokio::test]
    async fn rejects_files_and_relative_paths() -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let file = temp.path().join("notes.txt");
        fs::write(&file, b"notes").await?;
        let service = ProjectService::open(temp.path().join("projects.json")).await?;

        assert!(service.add("relative/path").await.is_err());
        assert!(service.add(file.to_string_lossy().as_ref()).await.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn derives_names_from_basename_and_deduplicates_only_full_paths()
    -> Result<(), Box<dyn std::error::Error>> {
        let temp = tempfile::tempdir()?;
        let service = ProjectService::open(temp.path().join("projects.json")).await?;
        service
            .observe_rpc_result(
                "thread/list",
                &json!({
                    "data": [
                        {"cwd": "/work/client/api", "recencyAt": 4},
                        {"cwd": "/work/server/api", "recencyAt": 3},
                        {"cwd": "/work/client/api/", "recencyAt": 7}
                    ]
                }),
            )
            .await;

        let listed = service.handle("companion/project/list", &json!({})).await?;
        assert_eq!(listed["data"].as_array().map(Vec::len), Some(2));
        assert_eq!(listed["data"][0]["path"], "/work/client/api");
        assert_eq!(listed["data"][0]["name"], "api");
        assert_eq!(listed["data"][0]["lastUsedAt"], 7);
        assert_eq!(listed["data"][1]["path"], "/work/server/api");
        assert_eq!(listed["data"][1]["name"], "api");
        assert_eq!(listed["data"][0]["pinned"], false);
        Ok(())
    }
}
