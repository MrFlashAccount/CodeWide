//! Stable JSON contract for one-time Companion-to-relay pairing.
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairRequest {
    pub invitation: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PairResponse {
    pub route_id: String,
    pub access_token: String,
    pub generation: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InvitationBundle {
    pub version: u8,
    pub relay_tls_pin_sha256: String,
    pub route_id: String,
    pub invitation: String,
}
