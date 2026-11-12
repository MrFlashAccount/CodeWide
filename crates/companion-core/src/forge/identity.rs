//! Each provider's display identity as its plugin declared it in
//! `initialize`: display name, default host and resolved icon.
//!
//! The companion knows no provider's name, host or icon on its own. A
//! session records the declaration; the icon is resolved once per distinct
//! declaration (plugin version, name, host and icon source) and the result
//! is kept in memory and durably, so a disabled or not yet started provider
//! still shows the identity it last declared. A provider that never
//! initialized shows its plugin id and no icon.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use forge_protocol::InitializeResult;
use serde::{Deserialize, Serialize};

use super::{
    icons::{self, IconFetcher, IconResolution},
    plugin_client::PluginSpec,
    wire::ProviderIconWire,
};
use crate::store::{IndexStore, forge_tables::FORGE_PROVIDER_IDENTITIES, kv::KvOp};

const STORED_VERSION: u32 = 1;
const MAX_NAME_CHARS: usize = 64;
const MAX_HOST_CHARS: usize = 253;
/// How long an icon whose source could not be read is shown as none before
/// the next session tries again.
const UNAVAILABLE_RETRY: Duration = Duration::from_mins(10);

/// What a client shows for one provider.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderIdentity {
    pub display_name: String,
    pub default_host: Option<String>,
    pub icon: Option<ProviderIconWire>,
}

impl ProviderIdentity {
    /// The identity of a provider that never declared one.
    #[must_use]
    pub fn undeclared(plugin_id: &str) -> Self {
        Self {
            display_name: plugin_id.to_owned(),
            default_host: None,
            icon: None,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredIdentity {
    version: u32,
    declaration: String,
    identity: ProviderIdentity,
}

struct Entry {
    declaration: String,
    identity: ProviderIdentity,
    /// Set while the icon source was unavailable: resolve again after it.
    retry_after: Option<Instant>,
}

#[derive(Clone)]
pub struct ProviderIdentities {
    store: Arc<IndexStore>,
    fetcher: Arc<dyn IconFetcher>,
    entries: Arc<Mutex<HashMap<String, Arc<Entry>>>>,
}

impl ProviderIdentities {
    #[must_use]
    pub fn new(store: Arc<IndexStore>, fetcher: Arc<dyn IconFetcher>) -> Self {
        Self {
            store,
            fetcher,
            entries: Arc::default(),
        }
    }

    /// Records the identity a provider declared in `initialize`, resolving
    /// its icon only when the declaration differs from the recorded one.
    pub async fn record(&self, spec: &PluginSpec, info: &InitializeResult) {
        let declaration = declaration_key(info);
        let current = self
            .memory(&spec.plugin_id)
            .or_else(|| self.stored(&spec.plugin_id));
        if current.as_ref().is_some_and(|entry| {
            entry.declaration == declaration
                && entry
                    .retry_after
                    .is_none_or(|retry_after| Instant::now() < retry_after)
        }) {
            return;
        }
        let resolution = match &info.provider_icon {
            Some(icon) => {
                icons::resolve(icon, spec.executable.parent(), self.fetcher.as_ref()).await
            }
            None => IconResolution::Settled(None),
        };
        let (icon, retry_after) = match resolution {
            IconResolution::Settled(icon) => (icon, None),
            IconResolution::Unavailable => {
                tracing::warn!(plugin_id = %spec.plugin_id, "forge provider icon is unavailable");
                (None, Some(Instant::now() + UNAVAILABLE_RETRY))
            }
        };
        let identity = ProviderIdentity {
            display_name: display_name(&info.forge_name).unwrap_or_else(|| spec.plugin_id.clone()),
            default_host: info.default_host.as_deref().and_then(host),
            icon,
        };
        if retry_after.is_none() {
            self.persist(&spec.plugin_id, &declaration, &identity);
        }
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(
                spec.plugin_id.clone(),
                Arc::new(Entry {
                    declaration,
                    identity,
                    retry_after,
                }),
            );
        }
    }

    /// The provider's last declared identity, or `None` when it never
    /// initialized on this companion.
    #[must_use]
    pub fn get(&self, plugin_id: &str) -> Option<ProviderIdentity> {
        self.memory(plugin_id)
            .or_else(|| self.stored(plugin_id))
            .map(|entry| entry.identity.clone())
    }

    fn memory(&self, plugin_id: &str) -> Option<Arc<Entry>> {
        self.entries.lock().ok()?.get(plugin_id).cloned()
    }

    /// Loads a durable identity into memory.
    fn stored(&self, plugin_id: &str) -> Option<Arc<Entry>> {
        let bytes = self
            .store
            .kv_get(FORGE_PROVIDER_IDENTITIES, plugin_id)
            .ok()??;
        let stored = serde_json::from_slice::<StoredIdentity>(&bytes)
            .ok()
            .filter(|stored| stored.version == STORED_VERSION)?;
        let entry = Arc::new(Entry {
            declaration: stored.declaration,
            identity: stored.identity,
            retry_after: None,
        });
        if let Ok(mut entries) = self.entries.lock() {
            entries
                .entry(plugin_id.to_owned())
                .or_insert_with(|| entry.clone());
        }
        Some(entry)
    }

    fn persist(&self, plugin_id: &str, declaration: &str, identity: &ProviderIdentity) {
        let stored = StoredIdentity {
            version: STORED_VERSION,
            declaration: declaration.to_owned(),
            identity: identity.clone(),
        };
        let written = serde_json::to_vec(&stored)
            .map_err(|error| error.to_string())
            .and_then(|value| {
                self.store
                    .kv_apply(vec![KvOp::Put {
                        table: FORGE_PROVIDER_IDENTITIES,
                        key: plugin_id.to_owned(),
                        value,
                    }])
                    .map_err(|error| error.to_string())
            });
        if written.is_err() {
            tracing::warn!(plugin_id = %plugin_id, "forge provider identity was not stored");
        }
    }
}

/// One digest of everything that shapes the identity, so an unchanged
/// declaration never re-reads a file or re-fetches a URL.
fn declaration_key(info: &InitializeResult) -> String {
    let encoded = serde_json::to_vec(&(
        &info.version,
        &info.forge_name,
        &info.default_host,
        &info.provider_icon,
    ))
    .unwrap_or_default();
    blake3::hash(&encoded).to_hex().to_string()
}

fn display_name(name: &str) -> Option<String> {
    let name: String = name
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(MAX_NAME_CHARS)
        .collect();
    (!name.is_empty()).then_some(name)
}

/// A lowercase host name with an optional port.
fn host(candidate: &str) -> Option<String> {
    let candidate = candidate.to_ascii_lowercase();
    let (name, port) = match candidate.split_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (candidate.as_str(), None),
    };
    let valid_name = !name.is_empty()
        && name.len() <= MAX_HOST_CHARS
        && !name.starts_with(['.', '-'])
        && !name.contains("..")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-'));
    let valid_port = port.is_none_or(|port| port.parse::<u16>().is_ok_and(|port| port > 0));
    (valid_name && valid_port).then_some(candidate)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use forge_protocol::{IconMimeType, PluginIcon};

    use super::*;
    use crate::forge::icons::FetchedIcon;

    struct CountingFetcher {
        calls: AtomicUsize,
        answer: bool,
    }

    #[async_trait::async_trait]
    impl IconFetcher for CountingFetcher {
        async fn fetch(&self, _url: &url::Url) -> Option<FetchedIcon> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            self.answer.then(|| FetchedIcon {
                content_type: Some("image/png".into()),
                bytes: b"\x89PNG\r\n\x1a\nrest".to_vec(),
            })
        }
    }

    fn info(version: &str, icon: Option<PluginIcon>) -> InitializeResult {
        InitializeResult {
            protocol_version: 1,
            provider: "fixture".into(),
            forge_name: " Fixture\u{7}Forge ".into(),
            version: version.into(),
            default_host: Some("Forge.Example:8443".into()),
            provider_icon: icon,
            capabilities: Vec::new(),
            media_hosts: Vec::new(),
            web_hosts: Vec::new(),
        }
    }

    fn spec(directory: &std::path::Path) -> PluginSpec {
        PluginSpec {
            plugin_id: "fixture".into(),
            executable: directory.join("codewide-forge-fixture"),
            args: Vec::new(),
            state_directory: directory.join("state"),
        }
    }

    fn url_icon() -> PluginIcon {
        PluginIcon::Url {
            url: "https://cdn.example/forge.png".into(),
        }
    }

    #[tokio::test]
    async fn a_url_icon_is_fetched_once_per_declaration_and_survives_a_restart() {
        let directory = tempfile::tempdir().expect("dir");
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb")).expect("store"));
        let fetcher = Arc::new(CountingFetcher {
            calls: AtomicUsize::new(0),
            answer: true,
        });
        let identities = ProviderIdentities::new(store.clone(), fetcher.clone());
        assert_eq!(identities.get("fixture"), None);

        identities
            .record(&spec(directory.path()), &info("1", Some(url_icon())))
            .await;
        identities
            .record(&spec(directory.path()), &info("1", Some(url_icon())))
            .await;
        assert_eq!(fetcher.calls.load(Ordering::SeqCst), 1);
        let identity = identities.get("fixture").expect("recorded");
        assert_eq!(identity.display_name, "FixtureForge");
        assert_eq!(identity.default_host.as_deref(), Some("forge.example:8443"));
        assert!(matches!(
            identity.icon,
            Some(ProviderIconWire::Image {
                mime_type: IconMimeType::Png,
                ..
            })
        ));

        let restarted = ProviderIdentities::new(store, fetcher.clone());
        assert_eq!(restarted.get("fixture"), Some(identity));
        restarted
            .record(&spec(directory.path()), &info("1", Some(url_icon())))
            .await;
        assert_eq!(
            fetcher.calls.load(Ordering::SeqCst),
            1,
            "stored declaration"
        );
        restarted
            .record(&spec(directory.path()), &info("2", Some(url_icon())))
            .await;
        assert_eq!(
            fetcher.calls.load(Ordering::SeqCst),
            2,
            "a new plugin version"
        );
    }

    #[tokio::test]
    async fn an_unreachable_icon_is_none_and_not_stored() {
        let directory = tempfile::tempdir().expect("dir");
        let store = Arc::new(IndexStore::open(directory.path().join("index.redb")).expect("store"));
        let fetcher = Arc::new(CountingFetcher {
            calls: AtomicUsize::new(0),
            answer: false,
        });
        let identities = ProviderIdentities::new(store.clone(), fetcher.clone());
        identities
            .record(&spec(directory.path()), &info("1", Some(url_icon())))
            .await;
        identities
            .record(&spec(directory.path()), &info("1", Some(url_icon())))
            .await;
        assert_eq!(
            fetcher.calls.load(Ordering::SeqCst),
            1,
            "retried only later"
        );
        assert_eq!(identities.get("fixture").expect("recorded").icon, None);
        assert_eq!(ProviderIdentities::new(store, fetcher).get("fixture"), None);
    }

    #[test]
    fn hosts_and_names_are_plain() {
        assert_eq!(host("GitHub.com").as_deref(), Some("github.com"));
        assert_eq!(host("ghe.test:8443").as_deref(), Some("ghe.test:8443"));
        for refused in ["", "https://github.com", "a..b", ".a", "a:0", "a:x", "a b"] {
            assert_eq!(host(refused), None, "{refused}");
        }
        assert_eq!(display_name("  \u{1b} "), None);
        assert_eq!(
            display_name(&"n".repeat(100)).map(|name| name.len()),
            Some(64)
        );
    }
}
