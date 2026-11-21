//! Codex model labels for thread snapshots. Both native and neutral catalog
//! responses supply names, before any multi-provider picker decoration.
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use agent_core::naming::{CatalogNames, ModelNaming};
use agent_transport::UpstreamHandle;
use serde_json::{Value, json};
use tokio::{sync::watch, time::Instant};

/// Start one discovery per connection. A stalled catalog must not hold up
/// the thread list; discovery may finish after this particular page.
const LIST_WAIT: Duration = Duration::from_millis(250);
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);
const RETRY_DELAY: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(super) struct ModelNames {
    connection: Mutex<(u64, Arc<ConnectionNames>)>,
}

impl ModelNames {
    pub(super) fn connection(&self, generation: u64) -> Option<Arc<ConnectionNames>> {
        let mut current = self
            .connection
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if generation > current.0 {
            *current = (generation, Arc::default());
        }
        (generation == current.0).then(|| Arc::clone(&current.1))
    }
}

#[derive(Clone, Copy, Default)]
enum Discovery {
    #[default]
    Cold,
    Loading,
    Ready,
    RetryAfter(Instant),
}

#[derive(Default)]
pub(super) struct ConnectionNames {
    pub(super) table: Arc<CatalogNames>,
    discovery: watch::Sender<Discovery>,
}

impl ConnectionNames {
    pub(super) fn observe_page(&self, rows: &[Value]) {
        self.table.extend(rows.iter().flat_map(|row| {
            let label = row["displayName"].as_str().filter(|s| !s.trim().is_empty());
            ["id", "model"].into_iter().filter_map(move |key| {
                let id = row[key].as_str().filter(|s| !s.trim().is_empty())?;
                Some((id, label?))
            })
        }));
    }

    pub(super) fn start(self: &Arc<Self>, upstream: &UpstreamHandle, generation: u64) {
        let start = self.discovery.send_if_modified(|state| {
            match *state {
                Discovery::Cold => {}
                Discovery::RetryAfter(retry) if Instant::now() >= retry => {}
                _ => return false,
            }
            *state = Discovery::Loading;
            true
        });
        if start {
            let names = Arc::clone(self);
            let upstream = upstream.clone();
            tokio::spawn(async move {
                let loaded =
                    tokio::time::timeout(DISCOVERY_TIMEOUT, names.load(&upstream, generation))
                        .await;
                names.discovery.send_replace(if matches!(loaded, Ok(true)) {
                    Discovery::Ready
                } else {
                    Discovery::RetryAfter(Instant::now() + RETRY_DELAY)
                });
            });
        }
    }

    pub(super) async fn wait_for_list(&self, threads: &[Value]) {
        let mut state = self.discovery.subscribe();
        if matches!(*state.borrow(), Discovery::Loading)
            && threads
                .iter()
                .filter_map(|row| row["model"].as_str())
                .any(|id| self.table.label(id).is_none())
        {
            let _ = tokio::time::timeout(
                LIST_WAIT,
                state.wait_for(|s| !matches!(s, Discovery::Loading)),
            )
            .await;
        }
    }

    async fn load(&self, upstream: &UpstreamHandle, generation: u64) -> bool {
        let mut cursor = None;
        let mut visited = HashSet::new();
        while upstream.generation() == generation {
            let Ok(response) = upstream
                .request(json!({
                    "id": "codewide-model-names", "method": "model/list",
                    "params": {"includeHidden": true, "limit": 100, "cursor": cursor}
                }))
                .await
            else {
                return false;
            };
            let Some(rows) = response.pointer("/result/data").and_then(Value::as_array) else {
                return false;
            };
            self.observe_page(rows);
            match &response["result"]["nextCursor"] {
                Value::Null => return true,
                Value::String(next) if visited.insert(next.clone()) => cursor = Some(next.clone()),
                _ => return false,
            }
        }
        false
    }
}
