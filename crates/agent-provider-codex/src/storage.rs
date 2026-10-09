//! Codex host storage behind the `codex.native` compatibility surface: the
//! rollout catalog and history (`history_service`), message search and the
//! thread resource projection (`resources`). The sync hub reaches these
//! modules only through the `NativeThreadStore`, `NativeMessageSearch` and
//! `NativeThreadResources` traits implemented here; error messages and codes
//! are the ones the hub forwarded before the move.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use agent_core::{
    provider::{
        HistoryPageError, HistorySyncRequest, NativeMessageSearch, NativeThreadResources,
        NativeThreadStore,
    },
    usage::price_replay_payload,
};
use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tracing::warn;

use crate::{
    catalog::CatalogError,
    history_service::{HistoryService, HistoryServiceError},
    pricing::OpenAiPricing,
    resources::ResourceService,
    rollout_changes,
};

/// The Codex-owned storage services of one host. Resources are optional:
/// without them resource reads answer "Resource service is unavailable".
pub struct CodexStorage {
    history: HistoryService,
    resources: Option<Arc<ResourceService>>,
}

impl CodexStorage {
    #[must_use]
    pub fn new(history: HistoryService) -> Self {
        Self {
            history,
            resources: None,
        }
    }

    /// Installs the rollout resource projector and its active-turn overlay.
    #[must_use]
    pub fn with_resources(mut self, resources: Arc<ResourceService>) -> Self {
        self.resources = Some(resources);
        self
    }
}

#[async_trait]
impl NativeThreadStore for CodexStorage {
    fn replay_event(&self, payload: Value) -> Result<Value, String> {
        self.history
            .catalog_event(price_replay_payload(payload, &OpenAiPricing))
            .map_err(|error| error.to_string())
    }

    fn annotate_thread(&self, thread: &mut Value) {
        crate::catalog_visibility::annotate_thread(thread);
    }

    fn is_supervisor_source(&self, source: &str) -> bool {
        crate::catalog_visibility::is_supervisor_owned_source(source)
    }

    async fn filter_thread_page(
        &self,
        page: Value,
        supervisor_source: Option<String>,
    ) -> Result<Value, String> {
        self.history
            .filter_catalog_page(page, supervisor_source)
            .await
            .map_err(|error| {
                warn!(err = ?error, "catalog visibility resolution failed");
                error.to_string()
            })
    }

    async fn enrich_thread_page(&self, page: Value) -> Value {
        self.history.enrich_thread_list(page).await
    }

    async fn activity_metadata(
        &self,
        thread_id: String,
        turn_ids: Vec<String>,
    ) -> Result<HashMap<String, Value>, String> {
        self.history
            .activity_metadata(thread_id, turn_ids)
            .await
            .map_err(|error| error.to_string())
    }

    async fn turns_page(&self, method: &str, params: &Value) -> Option<Result<Value, String>> {
        self.history
            .try_turns_page(method, params)
            .await
            .map(|page| page.map_err(|error| error.to_string()))
    }

    async fn history_page(
        &self,
        method: &str,
        params: &Value,
    ) -> Option<Result<Value, HistoryPageError>> {
        let page = match method {
            "companion/thread/history/after" => self.history.turns_after(params).await,
            "companion/thread/history/before" => self.history.turns_before(params).await,
            _ => return None,
        };
        Some(page.map_err(|error| match error {
            HistoryServiceError::HistorySourceChanged | HistoryServiceError::InvalidCursor => {
                HistoryPageError::Stale(error.to_string())
            }
            error => HistoryPageError::Failed(error.to_string()),
        }))
    }

    async fn sync_history(&self, request: HistorySyncRequest<'_>) -> Result<Value, String> {
        match self
            .history
            .sync_thread_history_with_source(
                request.thread_id,
                request.after_turn_id,
                request.limit,
                request.active_turn_id,
                request.source_witness,
            )
            .await
        {
            Ok(history) => Ok(history),
            // A thread without a rollout has no immutable history yet.
            Err(HistoryServiceError::Catalog(CatalogError::NotFound(_)))
                if request.after_turn_id.is_none() =>
            {
                Ok(json!({
                    "kind": "reset",
                    "headTurnId": Value::Null,
                    "turns": [],
                    "hasMore": false,
                    "olderCursor": Value::Null,
                }))
            }
            Err(error) => Err(error.to_string()),
        }
    }

    async fn enrich_active_turn(
        &self,
        thread_id: &str,
        active_turn: &mut Value,
    ) -> Result<(), String> {
        self.history
            .enrich_active_questions(thread_id, active_turn)
            .await
            .map_err(|error| error.to_string())?;
        self.history
            .enrich_active_realtime_transcripts(thread_id, active_turn)
            .await
            .map_err(|error| error.to_string())
    }

    fn subagent_descendants(&self, params: &Value) -> Result<Value, String> {
        self.history
            .subagent_descendants(params)
            .map_err(|error| error.to_string())
    }

    async fn pin_snapshot(&self, stored_threads: HashSet<String>) -> Result<Value, String> {
        let history = self.history.clone();
        tokio::task::spawn_blocking(move || {
            history.thread_pin_snapshot_for(&|id| stored_threads.contains(id))
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
    }

    fn spawn_change_monitor(&self, events: mpsc::Sender<Value>) {
        match self.history.spawn_rollout_monitor() {
            Ok(changes) => {
                tokio::spawn(rollout_changes::forward(
                    changes,
                    self.history.clone(),
                    events,
                    self.resources.clone(),
                ));
            }
            Err(error) => warn!(%error, "canonical rollout monitor is unavailable"),
        }
    }
}

#[async_trait]
impl NativeMessageSearch for CodexStorage {
    async fn search(&self, method: &str, params: &Value) -> Option<Result<Value, String>> {
        let result = match method {
            "companion/search/window" => self.history.search_window(params).await,
            "companion/search/context" => self.history.search_context(params).await,
            "companion/search" => self.history.search_messages(params).await,
            _ => return None,
        };
        Some(result.map_err(|error| error.to_string()))
    }
}

#[async_trait]
impl NativeThreadResources for CodexStorage {
    fn handles(&self, method: &str) -> bool {
        ResourceService::handles(method)
    }

    async fn read(&self, method: &str, params: &Value) -> Result<Value, String> {
        let Some(resources) = &self.resources else {
            return Err("Resource service is unavailable".into());
        };
        resources
            .handle(method, params)
            .await
            .map_err(|error| error.to_string())
    }

    fn prewarm(&self, thread_id: &str) {
        if let Some(resources) = &self.resources {
            resources.schedule_prewarm(thread_id);
        }
    }

    async fn observe_event(&self, payload: &Value) {
        if let Some(resources) = &self.resources {
            resources.observe(payload).await;
        }
    }

    async fn observe_rpc_result(&self, method: &str, result: &Value) {
        if let Some(resources) = &self.resources {
            resources.observe_rpc_result(method, result).await;
        }
    }
}
