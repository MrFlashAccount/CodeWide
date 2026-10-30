//! `companion/pullRequest/fileContent/read` (`forge.fileContent@1`): the
//! whole head file of a pull request, re-validated, and refused for a
//! provider that does not declare it.

use serde_json::{Value, json};

use crate::support::*;

const READ: &str = "companion/pullRequest/fileContent/read";
const PLUGIN_READ: &str = "forge.pullRequest.fileContent";
const HEAD_FILE: &str = "fn main() {\n    new();\n}\n";

fn with_contents() -> Value {
    let mut fixture = base_fixture();
    fixture["fileContents"] = json!({
        "src/a.rs": {"state": "text", "content": HEAD_FILE},
        "assets/logo.bin": {"state": "text", "content": "PNG\u{0}data"},
        "big.json": {"state": "tooLarge", "bytes": 5_000_000},
    });
    fixture
}

fn plugin_reads(harness: &Harness) -> Vec<Value> {
    harness
        .lines("traffic.jsonl")
        .into_iter()
        .filter(|frame| frame["in"]["method"] == PLUGIN_READ)
        .map(|frame| frame["in"]["params"].clone())
        .collect()
}

#[tokio::test]
async fn file_content_reaches_the_plugin_and_is_revalidated() {
    let harness = Harness::start(&with_contents());
    harness.link().await;
    let key = harness.pull_request().await;
    let read = |path: &str| json!({"pullRequest": key, "headRevision": "head-1", "path": path});

    let text = harness.ok(READ, read("src/a.rs")).await;
    assert_eq!(text, json!({"state": "text", "content": HEAD_FILE}));
    let sent = plugin_reads(&harness);
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0]["account"],
        json!({"host": "forge.test", "login": "octocat"})
    );
    assert_eq!(
        sent[0]["ref"],
        json!({"host": "forge.test", "repository": "octo/repo", "number": "7"})
    );
    assert_eq!(sent[0]["headRevision"], "head-1");
    assert_eq!(sent[0]["path"], "src/a.rs");

    // A plugin's NUL-bearing "text" never reaches the client as text.
    assert_eq!(
        harness.ok(READ, read("assets/logo.bin")).await,
        json!({"state": "binary"})
    );
    assert_eq!(
        harness.ok(READ, read("big.json")).await,
        json!({"state": "tooLarge", "bytes": 5_000_000})
    );
    assert_eq!(
        harness.ok(READ, read("src/removed.rs")).await,
        json!({"state": "missing"})
    );

    let before = plugin_reads(&harness).len();
    for (head, path) in [
        ("head-1", "../etc/passwd"),
        ("head-1", "/abs"),
        ("", "src/a.rs"),
    ] {
        let refused = harness
            .call(
                READ,
                json!({"pullRequest": key, "headRevision": head, "path": path}),
            )
            .await
            .expect_err("invalid params");
        assert_eq!(refused["code"], -32_602, "{head:?} {path:?}");
    }
    assert_eq!(
        plugin_reads(&harness).len(),
        before,
        "invalid params never reach the plugin"
    );
}

#[tokio::test]
async fn a_provider_without_file_content_is_refused_without_a_plugin_read() {
    let mut fixture = with_contents();
    fixture["hideCapabilities"] = json!(["forge.fileContent@1"]);
    let harness = Harness::start(&fixture);
    harness.link().await;
    let key = harness.pull_request().await;
    let sessions = harness.plugin_requests("initialize");
    let refused = harness
        .call(
            READ,
            json!({"pullRequest": key, "headRevision": "head-1", "path": "src/a.rs"}),
        )
        .await
        .expect_err("undeclared capability");
    assert_eq!(refused["code"], -32_080);
    assert_eq!(refused["data"]["capability"], "forge.fileContent@1");
    assert!(plugin_reads(&harness).is_empty());
    assert_eq!(
        harness.plugin_requests("initialize"),
        sessions,
        "the recorded declaration refuses without spawning the plugin"
    );
}
