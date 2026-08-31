//! Closed transport records for V2 HTTP, Terminal, and Voice boundaries.

use serde::{Deserialize, Serialize};

fn required_option<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileLocation {
    pub root_id: String,
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewLocation {
    pub path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentLocation {
    #[serde(deserialize_with = "required_option")]
    pub offset: Option<usize>,
    #[serde(deserialize_with = "required_option")]
    pub limit: Option<usize>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaMaterializeRequest {
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MediaMaterializeResponse {
    pub id: String,
    pub expires_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortDescriptor {
    pub port: u16,
    pub name: String,
    pub group: String,
    pub details: String,
    #[serde(deserialize_with = "required_option")]
    pub process: Option<String>,
    #[serde(deserialize_with = "required_option")]
    pub pid: Option<u32>,
    #[serde(deserialize_with = "required_option")]
    pub cwd: Option<String>,
    pub kind: String,
    pub forwarding_key: String,
    pub default_forwarding_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortsResponse {
    pub ports: Vec<PortDescriptor>,
    pub scanned_at: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TunnelCreateRequest {
    pub port: u16,
    #[serde(deserialize_with = "required_option")]
    pub ttl_seconds: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TunnelCreateResponse {
    pub id: String,
    pub expires_at: u64,
    pub base_path: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TerminalClientRecord {
    Open {
        version: u8,
        session_id: String,
        thread_id: String,
        generation: String,
        #[serde(deserialize_with = "required_option")]
        cwd: Option<String>,
        cols: u16,
        rows: u16,
        offset: String,
        create: bool,
    },
    Input {
        data: String,
    },
    Resize {
        cols: u16,
        rows: u16,
    },
    Close,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TerminalServerRecord {
    Opened {
        session_id: String,
        generation: String,
        offset: String,
    },
    Output {
        offset: String,
        data: String,
    },
    Exited {
        offset: String,
    },
    Error {
        error: TransportError,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum VoiceInputScope {
    Generic { id: String },
    Chat { id: String },
    Review { id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum VoiceClientRecord {
    Start {
        version: u8,
        generation: String,
        input_scope: VoiceInputScope,
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<String>,
        #[serde(deserialize_with = "required_option")]
        language: Option<String>,
    },
    Batch {
        session_id: String,
        sequence: String,
        sample_rate: u32,
        num_channels: u16,
        samples_per_channel: u64,
        data: String,
    },
    Finish {
        session_id: String,
    },
    Cancel {
        session_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum VoiceServerRecord {
    Started {
        session_id: String,
        generation: String,
    },
    Ack {
        session_id: String,
        sequence: String,
    },
    Result {
        session_id: String,
        text: String,
    },
    Retry {
        session_id: String,
        retry_after_ms: u64,
    },
    Cancelled {
        session_id: String,
    },
    Error {
        session_id: String,
        error: TransportError,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TransportError {
    pub code: TransportErrorCode,
    pub message: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TransportErrorCode {
    InvalidRequest,
    Unauthorized,
    Forbidden,
    NotFound,
    Conflict,
    Unavailable,
    LimitExceeded,
    GenerationChanged,
    ReplayUnavailable,
    IndeterminateDelivery,
}

impl TransportError {
    #[must_use]
    pub fn new(code: TransportErrorCode, message: &'static str) -> Self {
        Self {
            code,
            message: message.to_owned(),
        }
    }
}
