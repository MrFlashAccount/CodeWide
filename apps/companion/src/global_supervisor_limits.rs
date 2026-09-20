//! Generated/shared Rust surface for the Sync V1 global-supervisor limits.
//!
//! The JSON contract is authoritative. The contract parity test rejects drift
//! between this boundary surface and `contract/v1.json`.

use std::time::Duration;

/// Frozen correctness maxima for the first global-supervisor protocol version.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct GlobalSupervisorLimitsV1 {
    pub version: u32,
    pub live_channel_max_envelopes: usize,
    pub live_channel_max_bytes: usize,
    pub live_envelope_max_bytes: usize,
    pub microphone_input_buffer_max_duration_ms: u64,
    pub microphone_input_buffer_max_bytes: usize,
    pub output_playback_buffer_max_duration_ms: u64,
    pub output_playback_buffer_max_bytes: usize,
    pub dynamic_tool_input_max_bytes: usize,
    pub dynamic_tool_output_max_bytes: usize,
    pub list_chats_page_max_entries: usize,
    pub read_chat_page_max_items: usize,
    pub read_chat_page_max_bytes: usize,
    pub event_coalescing_max_distinct_sources: usize,
    pub event_coalescing_window_ms: u64,
    pub realtime_startup_timeout_ms: u64,
    pub interruption_ack_timeout_ms: u64,
    pub realtime_stop_close_timeout_ms: u64,
}

include!(concat!(env!("OUT_DIR"), "/global_supervisor_limits_v1.rs"));

impl GlobalSupervisorLimitsV1 {
    #[must_use]
    pub const fn realtime_startup_timeout(self) -> Duration {
        Duration::from_millis(self.realtime_startup_timeout_ms)
    }
}
