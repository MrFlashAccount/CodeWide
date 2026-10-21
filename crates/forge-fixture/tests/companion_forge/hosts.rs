//! Host composition: conformance, bundled updates, detection, links and tools.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::json;

use crate::support::*;

#[tokio::test]
async fn the_fixture_external_plugin_passes_conformance() {
    let state = tempfile::tempdir().expect("dir");
    let fixtures = forge_protocol::conformance::Fixtures {
        account: Some(forge_protocol::ForgeAccountRef {
            host: "forge.test".into(),
            login: "octocat".into(),
        }),
        pull_request: Some(forge_protocol::ForgePrRef {
            host: "forge.test".into(),
            repository: "octo/repo".into(),
            number: "7".into(),
        }),
        remote: Some("https://forge.test/octo/repo.git".into()),
        write_probes: true,
    };
    let report = forge_protocol::conformance::run(
        Path::new(FIXTURE),
        &["--id".to_owned(), "arcanum".to_owned()],
        &fixtures,
    )
    .await;
    drop(state);
    assert!(report.passed(), "{report:#?}");
    assert_eq!(report.provider.as_deref(), Some("arcanum"));
    assert!(
        report
            .checks
            .iter()
            .any(|check| check.name == "forge.pullRequest.action.run stale head")
    );
}

#[tokio::test]
async fn the_bundled_plugin_follows_a_host_update_of_its_generation() {
    let generations = tempfile::tempdir().expect("dir");
    for (generation, version) in [("a", "1.0.0"), ("b", "2.0.0")] {
        let libexec = generations.path().join(generation).join("libexec");
        std::fs::create_dir_all(&libexec).expect("libexec");
        // A symlink, not a copy: executing a freshly written file races with
        // forks of parallel tests (ETXTBSY). The plugin derives its id and
        // version from the invoked path.
        let binary = libexec.join("codewide-forge-github");
        std::os::unix::fs::symlink(FIXTURE, &binary).expect("link");
        std::fs::write(libexec.join("codewide-forge-github.version"), version).expect("version");
    }
    let current = generations.path().join("current");
    std::os::unix::fs::symlink(generations.path().join("a"), &current).expect("current");
    let harness = Harness::start_with(&base_fixture(), Some(current.join("libexec")));
    let session = harness
        .forge
        .context()
        .session("github")
        .await
        .expect("spawn a");
    assert_eq!(session.info().version, "1.0.0");
    session.shutdown().await;
    std::fs::remove_file(&current).expect("unlink");
    std::os::unix::fs::symlink(generations.path().join("b"), &current).expect("switch");
    let session = harness
        .forge
        .context()
        .session("github")
        .await
        .expect("spawn b");
    assert_eq!(
        session.info().version,
        "2.0.0",
        "the next spawn runs the new generation"
    );
    session.shutdown().await;
}

#[tokio::test]
async fn links_and_tombstones_are_companion_state_only() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let linked = harness
        .ok(
            "companion/pullRequest/links/set",
            json!({"pullRequest": key, "threadId": "thread-9", "linked": true}),
        )
        .await;
    assert_eq!(
        linked["links"],
        json!([{"threadId": "thread-9", "source": "manual"}])
    );
    let badges = harness
        .ok(
            "companion/pullRequestLinks/read",
            json!({"threadIds": ["thread-9"]}),
        )
        .await;
    assert_eq!(badges["threads"][0]["pullRequests"][0]["number"], "7");
    harness
        .ok(
            "companion/pullRequest/links/set",
            json!({"pullRequest": key, "threadId": "thread-9", "linked": false}),
        )
        .await;
    assert_eq!(
        harness.lines("writes.jsonl").len(),
        0,
        "links never write to a forge"
    );
    let too_many: Vec<String> = (0..201).map(|index| format!("t{index}")).collect();
    let error = harness
        .call(
            "companion/pullRequestLinks/read",
            json!({"threadIds": too_many}),
        )
        .await
        .expect_err("bounded");
    assert_eq!(error["code"], -32_602);
    let _ = harness.plugin_requests("initialize");
}

#[tokio::test]
async fn branch_detection_links_open_pull_requests_and_respects_tombstones() {
    let harness_dir = tempfile::tempdir().expect("dir");
    let vcs = Arc::new(companion_core::vcs::VcsService::new(
        harness_dir.path().join("vcs-plugins.json"),
    ));
    vcs.registry()
        .install(companion_core::vcs::VcsPluginConfig {
            id: "fixturevcs".into(),
            executable: PathBuf::from(FIXTURE),
            args: vec!["--vcs".into(), "--id".into(), "fixturevcs".into()],
            enabled: true,
            priority: 0,
        })
        .expect("vcs plugin");
    let harness = Harness::start_with_vcs(&base_fixture(), vcs);
    harness.link().await;
    let workspace = harness_dir.path().join("checkout");
    std::fs::create_dir_all(&workspace).expect("workspace");
    let threads: std::collections::HashSet<String> = ["thread-7".to_owned()].into();
    let context = harness.forge.context().clone();
    // A detached head links nothing.
    companion_core::forge::detection::detect(&context, workspace.to_str().expect("utf8"), &threads)
        .await;
    assert!(
        context
            .links
            .of_thread("thread-7")
            .expect("links")
            .is_empty()
    );
    std::fs::write(workspace.join(".fixture-branch"), "fix").expect("branch");
    companion_core::forge::detection::detect(&context, workspace.to_str().expect("utf8"), &threads)
        .await;
    let links = context.links.of_thread("thread-7").expect("links");
    assert_eq!(links.len(), 1);
    assert_eq!(links[0].number, "7");
    assert_eq!(
        serde_json::to_value(links[0].source).expect("source"),
        json!("branch")
    );
    let key = links[0].pull_request.clone();
    let thread = companion_core::agent::model::AppThreadId::parse("thread-7").expect("thread");
    context.links.unlink(&key, &thread).expect("unlink");
    companion_core::forge::detection::detect(&context, workspace.to_str().expect("utf8"), &threads)
        .await;
    assert!(
        context
            .links
            .of_thread("thread-7")
            .expect("links")
            .is_empty(),
        "a tombstone blocks re-adding"
    );
    assert_eq!(harness.lines("writes.jsonl").len(), 0);
}

#[tokio::test]
async fn the_link_tool_writes_only_companion_state() {
    use companion_core::agent::{
        model::{AppThreadId, ProviderId, ToolCallParams, TurnId},
        provider::ClientToolHost,
    };
    let harness = Harness::start(&base_fixture());
    let tools = harness.forge.tools();
    let call = |url: &str| ToolCallParams {
        app_thread_id: AppThreadId::parse("thread-tool").expect("thread"),
        turn_id: TurnId::parse("turn-1").expect("turn"),
        call_id: "call-1".into(),
        tool: "codewide_link_pull_request".into(),
        arguments: json!({"pullRequestUrl": url}),
    };
    let provider = ProviderId::parse("codex").expect("provider");
    let missing = tools
        .call(&provider, call("https://forge.test/octo/repo/pull/7"))
        .await;
    assert!(!missing.success);
    assert_eq!(
        serde_json::to_value(&missing.content).expect("content")[0]["text"],
        "no connected forge account"
    );
    harness.link().await;
    let linked = tools
        .call(&provider, call("https://forge.test/octo/repo/pull/7"))
        .await;
    assert!(linked.success, "{linked:?}");
    let links = harness
        .forge
        .context()
        .links
        .of_thread("thread-tool")
        .expect("links");
    assert_eq!(
        serde_json::to_value(links[0].source).expect("source"),
        json!("agent")
    );
    let foreign = tools
        .call(&provider, call("https://elsewhere.example/a/b/pull/1"))
        .await;
    assert!(!foreign.success);
    assert_eq!(
        harness.lines("writes.jsonl").len(),
        0,
        "the tool never writes to a forge"
    );
}

#[tokio::test]
async fn agent_halves_without_agents_fail_and_composer_acknowledgements_mark_sent() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    put_pr_draft(
        &harness,
        &key,
        "00000000-0000-4000-8000-0000000000b1",
        "agent",
    )
    .await;
    let sent = harness
        .ok(
            "companion/review/draft/sendToAgent",
            json!({"draftIds": ["00000000-0000-4000-8000-0000000000b1"], "idempotencyKey": "send-1"}),
        )
        .await;
    assert_eq!(sent["drafts"][0]["agent"], "failed");
    let session_draft = harness
        .ok(
            "companion/review/draft/put",
            json!({"draft": {
                "id": "00000000-0000-4000-8000-0000000000b2",
                "revision": {"source": {"kind": "vcs", "workspace": "/w", "scope": "branch"}, "revision": "snap-1"},
                "anchor": {"path": "/w/a.rs", "side": "new", "startLine": 1, "endLine": 1},
                "body": "check", "destination": "agent", "targetThreadId": "thread-1"},
                "expectedVersion": null}),
        )
        .await;
    assert_eq!(session_draft["sourceKind"], "vcs");
    let refused = harness
        .call(
            "companion/review/draft/sendToAgent",
            json!({"draftIds": ["00000000-0000-4000-8000-0000000000b2"], "idempotencyKey": "send-2"}),
        )
        .await
        .expect_err("VCS drafts go through the composer");
    assert_eq!(refused["code"], -32_602);
    let delivered = harness
        .ok(
            "companion/review/draft/agentDelivered",
            json!({"draftIds": ["00000000-0000-4000-8000-0000000000b2"]}),
        )
        .await;
    assert_eq!(delivered["drafts"][0]["agent"]["state"], "sent");
    let conflict = harness
        .call(
            "companion/review/draft/put",
            json!({"draft": {
                "id": "00000000-0000-4000-8000-0000000000b2",
                "revision": {"source": {"kind": "vcs", "workspace": "/w", "scope": "branch"}, "revision": "snap-1"},
                "anchor": {"path": "/w/a.rs", "side": "new", "startLine": 1, "endLine": 1},
                "body": "edited", "destination": "agent", "targetThreadId": "thread-1"},
                "expectedVersion": 1}),
        )
        .await
        .expect_err("stale version");
    assert_eq!(conflict["code"], -32_088);
    assert_eq!(conflict["data"]["kind"], "conflict");
    assert_eq!(conflict["data"]["current"]["version"], 2);
}
