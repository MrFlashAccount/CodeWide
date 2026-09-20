use crate::{Result, denied};
use serde::{Deserialize, Serialize};

pub const DEADLINE: std::time::Duration = std::time::Duration::from_secs(15);
pub const FRAME_BYTES: usize = 64 * 1024;
pub const STREAMS: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum Target {
    Device,
    Pairing,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum Control {
    Welcome { generation: u64 },
    Open { ticket: String, target: Target },
}

pub fn encode(value: &Control) -> Result<String> {
    let message = serde_json::to_string(value)?;
    if message.len() > 4096 {
        return Err(denied());
    }
    Ok(message)
}

pub fn decode(value: &str) -> Result<Control> {
    if value.len() > 4096 {
        return Err(denied());
    }
    Ok(serde_json::from_str(value)?)
}

pub fn nonce() -> String {
    hex::encode(rand::random::<[u8; 32]>())
}
