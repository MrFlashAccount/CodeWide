use codewide_companion::{
    global_supervisor_limits::{GLOBAL_SUPERVISOR_LIMITS_V1, GlobalSupervisorLimitsV1},
    sync::interest::{MAX_INTEREST_THREAD_ID_CHARS, MAX_INTEREST_THREADS, THREAD_TOPIC_KINDS},
    thread_patch::{THREAD_PATCH_FIELD, compile_thread_patch},
    thread_preview::{
        THREAD_PREVIEW_KIND, THREAD_PREVIEW_MAX_TEXT_CHARS, THREAD_PREVIEW_METHOD,
        THREAD_PREVIEW_PUBLISH_INTERVAL, THREAD_PREVIEW_TEXT_FIELD,
    },
    thread_view::READ_MODEL_VERSION,
};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct V1Contract {
    protocol_version: u32,
    thread_read_model_version: u64,
    web_socket_paths: Vec<String>,
    http_routes: Vec<String>,
    rpc_policy: RpcPolicy,
    thread_projection_patch: ThreadProjectionPatchContract,
    global_supervisor_limits_v1: GlobalSupervisorLimitsV1Contract,
    sync_interest: SyncInterestContract,
    thread_preview: ThreadPreviewContract,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncInterestContract {
    thread_topic_kinds: Vec<String>,
    max_interest_threads: usize,
    max_thread_id_chars: usize,
    hello_interest_required: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadPreviewContract {
    method: String,
    kind: String,
    publish_interval_ms: u64,
    max_text_chars: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GlobalSupervisorLimitsV1Contract {
    version: u32,
    live_channel_max_envelopes: usize,
    live_channel_max_bytes: usize,
    live_envelope_max_bytes: usize,
    microphone_input_buffer_max_duration_ms: u64,
    microphone_input_buffer_max_bytes: usize,
    output_playback_buffer_max_duration_ms: u64,
    output_playback_buffer_max_bytes: usize,
    dynamic_tool_input_max_bytes: usize,
    dynamic_tool_output_max_bytes: usize,
    list_chats_page_max_entries: usize,
    read_chat_page_max_items: usize,
    read_chat_page_max_bytes: usize,
    event_coalescing_max_distinct_sources: usize,
    event_coalescing_window_ms: u64,
    realtime_startup_timeout_ms: u64,
    interruption_ack_timeout_ms: u64,
    realtime_stop_close_timeout_ms: u64,
}

impl GlobalSupervisorLimitsV1Contract {
    fn into_shared(self) -> GlobalSupervisorLimitsV1 {
        GlobalSupervisorLimitsV1 {
            version: self.version,
            live_channel_max_envelopes: self.live_channel_max_envelopes,
            live_channel_max_bytes: self.live_channel_max_bytes,
            live_envelope_max_bytes: self.live_envelope_max_bytes,
            microphone_input_buffer_max_duration_ms: self.microphone_input_buffer_max_duration_ms,
            microphone_input_buffer_max_bytes: self.microphone_input_buffer_max_bytes,
            output_playback_buffer_max_duration_ms: self.output_playback_buffer_max_duration_ms,
            output_playback_buffer_max_bytes: self.output_playback_buffer_max_bytes,
            dynamic_tool_input_max_bytes: self.dynamic_tool_input_max_bytes,
            dynamic_tool_output_max_bytes: self.dynamic_tool_output_max_bytes,
            list_chats_page_max_entries: self.list_chats_page_max_entries,
            read_chat_page_max_items: self.read_chat_page_max_items,
            read_chat_page_max_bytes: self.read_chat_page_max_bytes,
            event_coalescing_max_distinct_sources: self.event_coalescing_max_distinct_sources,
            event_coalescing_window_ms: self.event_coalescing_window_ms,
            realtime_startup_timeout_ms: self.realtime_startup_timeout_ms,
            interruption_ack_timeout_ms: self.interruption_ack_timeout_ms,
            realtime_stop_close_timeout_ms: self.realtime_stop_close_timeout_ms,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadProjectionPatchContract {
    field: String,
    version: u32,
    operations: Vec<ThreadProjectionOperation>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RpcPolicy {
    method_filter: String,
    unknown_method_handling: String,
    passive_mode: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadProjectionOperation {
    method: String,
    kind: String,
    item_type: Option<String>,
    field: Option<String>,
    archived: Option<bool>,
}

#[test]
fn companion_implements_the_frozen_v1_contract() -> Result<(), Box<dyn std::error::Error>> {
    let raw = include_str!("../../../crates/companion-core/contract/v1.json");
    let contract: V1Contract = serde_json::from_str(raw)?;

    assert_eq!(contract.protocol_version, 1);
    assert_eq!(contract.thread_read_model_version, READ_MODEL_VERSION);
    assert_eq!(
        contract.global_supervisor_limits_v1.into_shared(),
        GLOBAL_SUPERVISOR_LIMITS_V1
    );
    assert_eq!(contract.web_socket_paths, ["/v1/app-server", "/v1/sync"]);
    assert_eq!(contract.thread_projection_patch.field, THREAD_PATCH_FIELD);
    assert_eq!(contract.thread_projection_patch.version, 1);
    for expected in &contract.thread_projection_patch.operations {
        let patch = compile_thread_patch(&json!({
            "method": expected.method,
            "params": {"threadId": "thread"}
        }))
        .unwrap_or_else(|| panic!("patch compiler is missing {}", expected.method));
        assert_eq!(patch["version"], contract.thread_projection_patch.version);
        assert_eq!(patch["operation"]["kind"], expected.kind);
        assert_eq!(
            patch["operation"]
                .get("itemType")
                .and_then(|value| value.as_str()),
            expected.item_type.as_deref()
        );
        assert_eq!(
            patch["operation"]
                .get("field")
                .and_then(|value| value.as_str()),
            expected.field.as_deref()
        );
        assert_eq!(
            patch["operation"].get("archived").and_then(Value::as_bool),
            expected.archived
        );
    }
    assert_eq!(contract.http_routes.len(), 21);
    assert_eq!(contract.rpc_policy.method_filter, "none");
    assert_eq!(
        contract.rpc_policy.unknown_method_handling,
        "forwardToAppServer"
    );
    assert_eq!(contract.rpc_policy.passive_mode, "noRpc");
    Ok(())
}

#[test]
fn sync_interest_and_thread_preview_match_the_contract() -> Result<(), Box<dyn std::error::Error>> {
    let raw = include_str!("../../../crates/companion-core/contract/v1.json");
    let contract: V1Contract = serde_json::from_str(raw)?;

    assert_eq!(
        contract.sync_interest.thread_topic_kinds,
        THREAD_TOPIC_KINDS
    );
    assert_eq!(
        contract.sync_interest.max_interest_threads,
        MAX_INTEREST_THREADS
    );
    assert_eq!(
        contract.sync_interest.max_thread_id_chars,
        MAX_INTEREST_THREAD_ID_CHARS
    );
    assert!(contract.sync_interest.hello_interest_required);
    for kind in &contract.sync_interest.thread_topic_kinds {
        assert!(
            contract
                .thread_projection_patch
                .operations
                .iter()
                .any(|operation| operation.kind == *kind),
            "thread topic kind {kind} is not a patch operation"
        );
    }
    assert_eq!(contract.thread_preview.method, THREAD_PREVIEW_METHOD);
    assert_eq!(contract.thread_preview.kind, THREAD_PREVIEW_KIND);
    assert_eq!(
        u128::from(contract.thread_preview.publish_interval_ms),
        THREAD_PREVIEW_PUBLISH_INTERVAL.as_millis()
    );
    assert_eq!(
        contract.thread_preview.max_text_chars,
        THREAD_PREVIEW_MAX_TEXT_CHARS
    );
    assert!(
        contract
            .thread_projection_patch
            .operations
            .iter()
            .any(|operation| operation.method == THREAD_PREVIEW_METHOD
                && operation.kind == THREAD_PREVIEW_KIND),
        "the preview operation is part of the patch contract"
    );
    assert!(
        !contract
            .sync_interest
            .thread_topic_kinds
            .iter()
            .any(|kind| kind == THREAD_PREVIEW_KIND),
        "the preview is a catalog topic"
    );
    let preview = compile_thread_patch(&json!({
        "method": THREAD_PREVIEW_METHOD,
        "params": {"threadId": "thread", THREAD_PREVIEW_TEXT_FIELD: "streaming"}
    }))
    .ok_or("preview patch missing")?;
    assert_eq!(
        preview["operation"]["summary"],
        json!({
            "activity": true,
            "conversationMessage": false,
            "finalAgentResponse": false,
            "previewText": "streaming"
        })
    );
    Ok(())
}
