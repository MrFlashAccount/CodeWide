//! The shared harness: a forge and review service over a temporary store
//! with the fixture plugin registered as an external provider.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

use companion_core::{
    forge::{
        ForgeConfig, ForgeDeps, ForgeEvents, ForgeService,
        registry::{ExternalPlugin, PluginRegistry},
    },
    review::{ReviewEvents, ReviewService},
    store::IndexStore,
};
use serde_json::{Value, json};

pub const FIXTURE: &str = env!("CARGO_BIN_EXE_forge-fixture-plugin");
pub const PATCH: &str = "@@ -1,2 +1,2 @@\n fn main() {\n-    old();\n+    new();\n";

pub struct Harness {
    pub _dir: tempfile::TempDir,
    pub root: PathBuf,
    pub store: Arc<IndexStore>,
    pub forge: Arc<ForgeService>,
    pub review: Arc<ReviewService>,
    pub events: Arc<Mutex<Vec<Value>>>,
}

impl Harness {
    pub fn start(fixture: &Value) -> Self {
        Self::start_with(fixture, None)
    }

    pub fn start_with_vcs(fixture: &Value, vcs: Arc<companion_core::vcs::VcsService>) -> Self {
        Self::start_full(fixture, None, Some(vcs))
    }

    pub fn start_with(fixture: &Value, bundled: Option<PathBuf>) -> Self {
        Self::start_full(fixture, bundled, None)
    }

    pub fn start_full(
        fixture: &Value,
        bundled: Option<PathBuf>,
        vcs: Option<Arc<companion_core::vcs::VcsService>>,
    ) -> Self {
        let dir = tempfile::tempdir().expect("dir");
        let root = dir.path().to_path_buf();
        let store = Arc::new(IndexStore::open(root.join("state.redb")).expect("store"));
        let (sender, mut receiver) = tokio::sync::mpsc::channel(10_000);
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        tokio::spawn(async move {
            while let Some(event) = receiver.recv().await {
                sink.lock().expect("events").push(event);
            }
        });
        let review =
            ReviewService::new(store.clone(), ReviewEvents::new(sender.clone()), None, None);
        let config = ForgeConfig {
            bundled_plugin_directory: bundled,
            registry_path: root.join("forge-plugins.json"),
            plugin_state_root: root.join("forge-plugins"),
        };
        PluginRegistry::new(config.registry_path.clone())
            .install(ExternalPlugin {
                id: "fixture".into(),
                executable: PathBuf::from(FIXTURE),
                args: vec!["--id".into(), "fixture".into()],
                priority: 10,
            })
            .expect("install fixture");
        let forge = ForgeService::new(
            config,
            ForgeDeps {
                store: store.clone(),
                events: ForgeEvents::new(sender),
                review: review.clone(),
                agents: None,
                workspaces: None,
                vcs,
            },
        );
        let harness = Self {
            _dir: dir,
            root,
            store,
            forge,
            review,
            events,
        };
        harness.set_fixture(fixture);
        harness
    }

    pub fn state(&self) -> PathBuf {
        self.root.join("forge-plugins/fixture")
    }

    pub fn set_fixture(&self, fixture: &Value) {
        std::fs::create_dir_all(self.state()).expect("state");
        std::fs::write(self.state().join("fixture.json"), fixture.to_string()).expect("fixture");
    }

    pub fn lines(&self, name: &str) -> Vec<Value> {
        std::fs::read_to_string(self.state().join(name))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect()
    }

    pub fn writes(&self, method: &str) -> usize {
        self.lines("writes.jsonl")
            .iter()
            .filter(|write| write["method"] == method)
            .count()
    }

    pub fn plugin_requests(&self, method: &str) -> usize {
        self.lines("traffic.jsonl")
            .iter()
            .filter(|frame| frame["in"]["method"] == method)
            .count()
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value, Value> {
        if ReviewService::handles(method) {
            self.review
                .handle(method, &params)
                .await
                .map_err(|error| error.to_rpc_error())
        } else {
            self.forge
                .handle(method, &params)
                .await
                .map_err(|error| error.to_rpc_error())
        }
    }

    pub async fn ok(&self, method: &str, params: Value) -> Value {
        let result = self.call(method, params).await;
        assert!(result.is_ok(), "{method} failed: {result:?}");
        result.unwrap_or_default()
    }

    pub async fn link(&self) -> String {
        let linked = self
            .ok(
                "companion/forge/auth/start",
                json!({"pluginId": "fixture", "methodId": "existing", "host": "forge.test", "login": "octocat", "idempotencyKey": "link-1"}),
            )
            .await;
        assert_eq!(linked["kind"], "connected");
        linked["account"]["account"]
            .as_str()
            .expect("account")
            .to_owned()
    }

    pub async fn pull_request(&self) -> String {
        let page = self
            .ok(
                "companion/pullRequests/list",
                json!({"category": "reviewRequested", "repository": null, "cursor": null}),
            )
            .await;
        page["sections"][0]["rows"][0]["pullRequest"]
            .as_str()
            .expect("row")
            .to_owned()
    }
}

pub fn base_fixture() -> Value {
    json!({
        "hostLogins": ["octocat"],
        "pasteTokens": [{"token": "valid-sentinel-token", "login": "paster", "scopes": ["repo"]}],
        "files": [{"path": "src/a.rs", "patch": PATCH}],
        "openByBranch": [{"repository": "octo/repo", "branch": "fix", "numbers": ["7"]}]
    })
}

/// Stores a draft on the fixture pull request at `head-1`, anchored to its
/// first hunk.
pub async fn put_pr_draft(harness: &Harness, key: &str, id: &str, destination: &str) -> Value {
    let hunks = harness
        .ok(
            "companion/review/hunks/read",
            json!({"source": {"kind": "pullRequest", "pullRequest": key}, "revision": "head-1"}),
        )
        .await;
    let hunk = &hunks["files"][0]["hunks"][0];
    let mut draft = json!({
        "id": id,
        "revision": {"source": {"kind": "pullRequest", "pullRequest": key}, "revision": "head-1"},
        "anchor": {"path": "src/a.rs", "side": "new", "startLine": 2, "endLine": 2,
                   "hunk": {"id": hunk["id"], "fingerprint": hunk["fingerprint"]}},
        "body": "Rename this.",
        "destination": destination,
    });
    if destination != "pr" {
        draft["targetThreadId"] = json!("thread-1");
    }
    harness
        .ok(
            "companion/review/draft/put",
            json!({"draft": draft, "expectedVersion": null}),
        )
        .await
}
