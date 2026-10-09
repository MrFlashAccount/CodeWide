//! Neutral operations and the JSON-RPC envelope (mirror of
//! `packages/agent-protocol/src/v1/operations.ts` and `rpc.ts`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    capabilities::CapabilitySet,
    ids::{AppThreadId, ClientMessageId, NativeRequestId, ProviderId, TurnId},
    thread::{AgentThread, AgentTurn, RuntimeResponse, ThreadSettings, UserContent},
};

pub const PROTOCOL_NAME: &str = "codewide-agent";
pub const PROTOCOL_VERSION: u32 = 1;

/// Invalid request or unknown thread (`thread not found: <id>`).
pub const ERROR_INVALID_REQUEST: i64 = -32_600;
pub const ERROR_METHOD_NOT_FOUND: i64 = -32_601;
pub const ERROR_INVALID_PARAMS: i64 = -32_602;
/// The thread's provider is disabled on this host (terminal for queued commands).
pub const ERROR_PROVIDER_DISABLED: i64 = -32_070;
/// The thread's provider does not declare the capability the call needs.
pub const ERROR_CAPABILITY_UNSUPPORTED: i64 = -32_072;

pub const EXPECTED_TURN_NOT_ACTIVE: &str = "expected turn is not active";

#[must_use]
pub fn thread_not_found_message(app_thread_id: &str) -> String {
    format!("thread not found: {app_thread_id}")
}

#[must_use]
pub fn capability_unsupported_message(capability: &str) -> String {
    format!("{capability} is not supported by this thread's agent")
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ClientIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub protocol: String,
    pub protocol_version: u32,
    pub client: ClientIdentity,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: ProviderId,
    pub display_name: String,
    pub model_provider: String,
    pub version: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ProviderAccount {
    pub authenticated: bool,
    pub label: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub protocol_version: u32,
    pub provider: ProviderDescriptor,
    pub capabilities: CapabilitySet,
    pub account: Option<ProviderAccount>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct Empty {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ModelEffort {
    pub effort: String,
    pub description: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum InputModality {
    Text,
    Image,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub model: String,
    pub display_name: String,
    pub description: String,
    pub is_default: bool,
    pub hidden: bool,
    pub efforts: Vec<ModelEffort>,
    pub default_effort: Option<String>,
    pub input_modalities: Vec<InputModality>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ModelCatalog {
    pub models: Vec<ModelEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionProfileEntry {
    pub id: String,
    pub display_name: String,
    pub description: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct PermissionProfileCatalog {
    pub profiles: Vec<PermissionProfileEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortWindow {
    pub lower: Option<i64>,
    pub lower_inclusive: bool,
    pub upper: Option<i64>,
    pub upper_inclusive: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThreadSortKey {
    CreatedAt,
    UpdatedAt,
    RecencyAt,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ItemsView {
    NotLoaded,
    Summary,
    Full,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadCreateParams {
    pub app_thread_id: Option<AppThreadId>,
    pub cwd: String,
    pub settings: ThreadSettings,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThreadResult {
    pub thread: AgentThread,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRef {
    pub app_thread_id: AppThreadId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadReadResult {
    pub thread: AgentThread,
    pub active_turn_id: Option<TurnId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListParams {
    pub archived: bool,
    pub cwd: Option<String>,
    pub search_term: Option<String>,
    pub sort_key: ThreadSortKey,
    pub sort_direction: SortDirection,
    pub window: Option<SortWindow>,
    pub cursor: Option<String>,
    pub limit: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListResult {
    pub threads: Vec<AgentThread>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTurnsParams {
    pub app_thread_id: AppThreadId,
    pub cursor: Option<String>,
    pub limit: u32,
    pub sort_direction: SortDirection,
    pub items_view: ItemsView,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadTurnsResult {
    pub turns: Vec<AgentTurn>,
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ThreadChange {
    Name {
        name: Option<String>,
    },
    Archived {
        archived: bool,
    },
    Deleted,
    Settings {
        model: Option<String>,
        effort: Option<String>,
        permission_profile: Option<String>,
        service_tier: Option<String>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadUpdateParams {
    pub app_thread_id: AppThreadId,
    pub change: ThreadChange,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ThreadUpdateResult {
    pub thread: Option<AgentThread>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ThreadOwnsResult {
    pub owned: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnStartParams {
    pub app_thread_id: AppThreadId,
    pub client_message_id: Option<ClientMessageId>,
    pub input: Vec<UserContent>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TurnStartResult {
    Started { turn_id: TurnId },
    Busy { active_turn_id: TurnId },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerParams {
    pub app_thread_id: AppThreadId,
    pub expected_turn_id: TurnId,
    pub client_message_id: Option<ClientMessageId>,
    pub input: Vec<UserContent>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnSteerResult {
    pub turn_id: TurnId,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnInterruptParams {
    pub app_thread_id: AppThreadId,
    pub turn_id: Option<TurnId>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestRespondParams {
    pub app_thread_id: AppThreadId,
    pub request_id: NativeRequestId,
    pub response: RuntimeResponse,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CapabilityInvokeParams {
    pub capability: String,
    pub method: String,
    pub params: Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CapabilityInvokeResult {
    pub result: Value,
}

/// One operation call with its typed params, tagged by method name.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "method", content = "params")]
pub enum OperationCall {
    #[serde(rename = "initialize")]
    Initialize(InitializeParams),
    #[serde(rename = "catalog.models")]
    CatalogModels(Empty),
    #[serde(rename = "catalog.permissionProfiles")]
    CatalogPermissionProfiles(Empty),
    #[serde(rename = "thread.create")]
    ThreadCreate(ThreadCreateParams),
    #[serde(rename = "thread.read")]
    ThreadRead(ThreadRef),
    #[serde(rename = "thread.list")]
    ThreadList(ThreadListParams),
    #[serde(rename = "thread.turns")]
    ThreadTurns(ThreadTurnsParams),
    #[serde(rename = "thread.update")]
    ThreadUpdate(ThreadUpdateParams),
    #[serde(rename = "thread.owns")]
    ThreadOwns(ThreadRef),
    #[serde(rename = "thread.compact")]
    ThreadCompact(ThreadRef),
    #[serde(rename = "turn.start")]
    TurnStart(TurnStartParams),
    #[serde(rename = "turn.steer")]
    TurnSteer(TurnSteerParams),
    #[serde(rename = "turn.interrupt")]
    TurnInterrupt(TurnInterruptParams),
    #[serde(rename = "request.respond")]
    RequestRespond(RequestRespondParams),
    #[serde(rename = "capability.invoke")]
    CapabilityInvoke(CapabilityInvokeParams),
    #[serde(rename = "nativeSession.list")]
    NativeSessionList(super::sessions::NativeSessionListParams),
    #[serde(rename = "nativeSession.read")]
    NativeSessionRead(super::sessions::NativeSessionReadParams),
}

/// JSON-RPC request envelope.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RequestEnvelope {
    pub id: Value,
    #[serde(flatten)]
    pub call: OperationCall,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RpcErrorData {
    pub capability: Option<String>,
    pub provider: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
    pub data: Option<RpcErrorData>,
}

impl RpcError {
    #[must_use]
    pub fn new(code: i64, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            data: None,
        }
    }
}
