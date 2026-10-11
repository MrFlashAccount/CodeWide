//! Full-text search over a provider's own stored history, in neutral form
//! (`history.messageSearch` of a provider without the `codex.native`
//! surface). Pages and context are the shared `companion/search` shapes; a
//! window carries neutral turns that the companion projects for the client.

use async_trait::async_trait;
use serde_json::Value;

use crate::model::AgentTurn;

/// The indexed messages around a hit and the turns they belong to.
pub struct SearchWindow {
    /// The `companion/search/context` page around the hit.
    pub page: Value,
    /// The hit's turns in history order, summary items only.
    pub turns: Vec<AgentTurn>,
}

#[async_trait]
pub trait StoredMessageSearch: Send + Sync {
    /// `companion/search`: one page of hits over this provider's threads.
    async fn search(&self, params: &Value) -> Result<Value, String>;

    /// `companion/search/context`: indexed messages around one hit.
    async fn context(&self, params: &Value) -> Result<Value, String>;

    /// `companion/search/window`: context plus the hit's neutral turns.
    async fn window(&self, params: &Value) -> Result<SearchWindow, String>;
}
