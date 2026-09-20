use std::{env, error::Error, fs, io, path::PathBuf};

use serde_json::{Map, Value};

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed=contract/v1.json");
    let raw = fs::read_to_string("contract/v1.json")?;
    let contract: Value = serde_json::from_str(&raw)?;
    let limits = contract
        .get("globalSupervisorLimitsV1")
        .and_then(Value::as_object)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidData,
                "globalSupervisorLimitsV1 must be an object",
            )
        })?;
    let generated = generate_limits(limits)?;
    let output = PathBuf::from(
        env::var_os("OUT_DIR")
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "OUT_DIR must be set"))?,
    )
    .join("global_supervisor_limits_v1.rs");
    fs::write(output, generated)?;
    Ok(())
}

fn generate_limits(limits: &Map<String, Value>) -> io::Result<String> {
    Ok(format!(
        r"pub const GLOBAL_SUPERVISOR_LIMITS_V1: GlobalSupervisorLimitsV1 = GlobalSupervisorLimitsV1 {{
    version: {},
    live_channel_max_envelopes: {},
    live_channel_max_bytes: {},
    live_envelope_max_bytes: {},
    microphone_input_buffer_max_duration_ms: {},
    microphone_input_buffer_max_bytes: {},
    output_playback_buffer_max_duration_ms: {},
    output_playback_buffer_max_bytes: {},
    dynamic_tool_input_max_bytes: {},
    dynamic_tool_output_max_bytes: {},
    list_chats_page_max_entries: {},
    read_chat_page_max_items: {},
    read_chat_page_max_bytes: {},
    event_coalescing_max_distinct_sources: {},
    event_coalescing_window_ms: {},
    realtime_startup_timeout_ms: {},
    interruption_ack_timeout_ms: {},
    realtime_stop_close_timeout_ms: {},
}};
",
        integer(limits, "version")?,
        integer(limits, "liveChannelMaxEnvelopes")?,
        integer(limits, "liveChannelMaxBytes")?,
        integer(limits, "liveEnvelopeMaxBytes")?,
        integer(limits, "microphoneInputBufferMaxDurationMs")?,
        integer(limits, "microphoneInputBufferMaxBytes")?,
        integer(limits, "outputPlaybackBufferMaxDurationMs")?,
        integer(limits, "outputPlaybackBufferMaxBytes")?,
        integer(limits, "dynamicToolInputMaxBytes")?,
        integer(limits, "dynamicToolOutputMaxBytes")?,
        integer(limits, "listChatsPageMaxEntries")?,
        integer(limits, "readChatPageMaxItems")?,
        integer(limits, "readChatPageMaxBytes")?,
        integer(limits, "eventCoalescingMaxDistinctSources")?,
        integer(limits, "eventCoalescingWindowMs")?,
        integer(limits, "realtimeStartupTimeoutMs")?,
        integer(limits, "interruptionAckTimeoutMs")?,
        integer(limits, "realtimeStopCloseTimeoutMs")?,
    ))
}

fn integer(limits: &Map<String, Value>, field: &str) -> io::Result<String> {
    let value = limits.get(field).and_then(Value::as_u64).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("globalSupervisorLimitsV1.{field} must be a non-negative integer"),
        )
    })?;
    let digits = value.to_string();
    let mut literal = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            literal.push('_');
        }
        literal.push(digit);
    }
    Ok(literal)
}
