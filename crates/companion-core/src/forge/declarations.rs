//! What each provider declared in its last `initialize`: capabilities and
//! media hosts, kept in memory so the media path can decide without
//! spawning a plugin for every image. Every session refreshes the entry, so
//! a replaced plugin binary is picked up by its next call.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use forge_protocol::InitializeResult;

const MAX_MEDIA_HOSTS: usize = 32;
const MAX_HOST_CHARS: usize = 253;

/// One provider's declaration.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Declaration {
    pub capabilities: Vec<String>,
    /// Lowercase host names only; anything else a plugin sends is dropped.
    pub media_hosts: Vec<String>,
}

impl Declaration {
    #[must_use]
    pub fn supports(&self, capability: &str) -> bool {
        self.capabilities
            .iter()
            .any(|declared| declared == capability)
    }

    #[must_use]
    pub fn from_info(info: &InitializeResult) -> Self {
        Self {
            capabilities: info.capabilities.clone(),
            media_hosts: info
                .media_hosts
                .iter()
                .map(|host| host.to_ascii_lowercase())
                .filter(|host| valid_host(host))
                .take(MAX_MEDIA_HOSTS)
                .collect(),
        }
    }
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= MAX_HOST_CHARS
        && !host.starts_with(['.', '-'])
        && !host.contains("..")
        && host
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'))
}

#[derive(Clone, Default)]
pub struct Declarations {
    entries: Arc<Mutex<HashMap<String, Declaration>>>,
}

impl Declarations {
    pub fn record(&self, plugin_id: &str, info: &InitializeResult) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(plugin_id.to_owned(), Declaration::from_info(info));
        }
    }

    #[must_use]
    pub fn get(&self, plugin_id: &str) -> Option<Declaration> {
        self.entries.lock().ok()?.get(plugin_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn media_hosts_keep_only_plain_host_names() {
        let info = InitializeResult {
            protocol_version: 1,
            provider: "p".into(),
            forge_name: "P".into(),
            version: "1".into(),
            default_host: None,
            provider_icon: None,
            capabilities: vec!["forge.conversation@1".into()],
            media_hosts: vec![
                "Media.Example.com".into(),
                "*.example.com".into(),
                "https://x.example.com".into(),
                ".example.com".into(),
            ],
        };
        let declaration = Declaration::from_info(&info);
        assert_eq!(declaration.media_hosts, ["media.example.com"]);
        assert!(declaration.supports("forge.conversation@1"));
    }
}
