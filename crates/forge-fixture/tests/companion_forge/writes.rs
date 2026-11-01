//! Forge writes: action runs, Submit review and viewed marks.

use serde_json::{Value, json};

use crate::support::*;

#[tokio::test]
async fn action_runs_enforce_confirmation_staleness_and_idempotency() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let run = |confirmation: &str, key_suffix: &str, action: &str, head: &str| {
        json!({"pullRequest": key, "actionId": action, "headRevision": head, "input": null,
               "confirmation": confirmation, "idempotencyKey": format!("run-{key_suffix}")})
    };
    let refused = harness
        .call(
            "companion/pullRequest/action/run",
            run("none", "1", "merge", "head-1"),
        )
        .await
        .expect_err("merge needs destructive confirmation");
    assert_eq!(refused["code"], -32_089);
    assert_eq!(refused["data"]["required"], "destructive");
    assert_eq!(harness.writes("forge.pullRequest.action.run"), 0);
    let verdict = harness
        .call(
            "companion/pullRequest/action/run",
            run("destructive", "2", "approve", "head-1"),
        )
        .await
        .expect_err("verdicts run only through Submit");
    assert_eq!(verdict["code"], -32_602);
    let merged = harness
        .ok(
            "companion/pullRequest/action/run",
            run("destructive", "3", "merge", "head-1"),
        )
        .await;
    assert_eq!(merged["message"], "Merged");
    assert_eq!(merged["catalog"]["headRevision"], "head-1");
    let replay = harness
        .ok(
            "companion/pullRequest/action/run",
            run("destructive", "3", "merge", "head-1"),
        )
        .await;
    assert_eq!(replay, merged);
    assert_eq!(
        harness.writes("forge.pullRequest.action.run"),
        1,
        "one journal outcome, one write"
    );
    let mut moved = base_fixture();
    moved["headRevision"] = json!("head-2");
    harness.set_fixture(&moved);
    let stale = harness
        .call(
            "companion/pullRequest/action/run",
            run("destructive", "4", "merge", "head-1"),
        )
        .await
        .expect_err("stale");
    assert_eq!(stale["code"], -32_082);
    assert_eq!(stale["data"]["headRevision"], "head-2");
    assert_eq!(stale["data"]["catalog"]["headRevision"], "head-2");
    assert_eq!(
        harness.writes("forge.pullRequest.action.run"),
        1,
        "nothing written at a stale head"
    );
    let mut rejecting = moved.clone();
    rejecting["actionMode"] = json!("rejected");
    harness.set_fixture(&rejecting);
    let rejected = harness
        .call(
            "companion/pullRequest/action/run",
            run("destructive", "5", "merge", "head-2"),
        )
        .await
        .expect_err("rejected");
    assert_eq!(rejected["code"], -32_083);
    assert_eq!(rejected["data"]["kind"], "forgeRejected");
    let records = harness.forge.context().journal.records().expect("journal");
    assert_eq!(
        records.len(),
        2,
        "one record per run that reached the plugin"
    );
}

#[tokio::test]
async fn submit_publishes_once_and_replays_its_stored_outcome() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let first = put_pr_draft(&harness, &key, "00000000-0000-4000-8000-000000000001", "pr").await;
    assert_eq!(first["sourceKind"], "pullRequest");
    assert_eq!(first["pr"]["state"], "pending");
    put_pr_draft(
        &harness,
        &key,
        "00000000-0000-4000-8000-000000000002",
        "both",
    )
    .await;
    let agent_only = put_pr_draft(
        &harness,
        &key,
        "00000000-0000-4000-8000-000000000003",
        "agent",
    )
    .await;
    assert_eq!(agent_only["destination"], "agent");
    let session_pr = harness
        .call(
            "companion/review/draft/put",
            json!({"draft": {
                "id": "00000000-0000-4000-8000-000000000009",
                "revision": {"source": {"kind": "session", "threadId": "t", "resource": "session"}, "revision": "r"},
                "anchor": {"path": "a", "side": "new", "startLine": 1, "endLine": 1},
                "body": "x", "destination": "pr"}, "expectedVersion": null}),
        )
        .await
        .expect_err("pr destinations need a pull request source");
    assert_eq!(session_pr["code"], -32_602);
    assert_eq!(
        harness.writes("forge.pullRequest.review.submit"),
        0,
        "drafts write nothing"
    );
    let submit = |key_suffix: &str, ids: Value, head: &str| {
        json!({"pullRequest": key, "headRevision": head, "verdictActionId": "comment", "body": "Thanks",
               "draftIds": ids, "forwardBothToAgent": true, "idempotencyKey": format!("submit-{key_suffix}")})
    };
    let agent_rejected = harness
        .call(
            "companion/pullRequest/review/submit",
            submit(
                "0",
                json!(["00000000-0000-4000-8000-000000000003"]),
                "head-1",
            ),
        )
        .await
        .expect_err("agent-only drafts are never submitted");
    assert_eq!(agent_rejected["code"], -32_602);
    let ids = json!([
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002"
    ]);
    let outcome = harness
        .ok(
            "companion/pullRequest/review/submit",
            submit("1", ids.clone(), "head-1"),
        )
        .await;
    assert_eq!(outcome["drafts"][0]["pr"], "published");
    assert_eq!(outcome["drafts"][0]["agent"], "notRequested");
    assert_eq!(outcome["drafts"][1]["pr"], "published");
    assert_eq!(
        outcome["drafts"][1]["agent"], "failed",
        "no agents on this companion"
    );
    let replay = harness
        .ok(
            "companion/pullRequest/review/submit",
            submit("1", ids, "head-1"),
        )
        .await;
    assert_eq!(replay, outcome);
    assert_eq!(harness.writes("forge.pullRequest.review.submit"), 1);
    let drafts = harness
        .ok(
            "companion/review/drafts/read",
            json!({"source": {"kind": "pullRequest", "pullRequest": key}}),
        )
        .await;
    let published = drafts["drafts"]
        .as_array()
        .expect("drafts")
        .iter()
        .find(|draft| draft["id"] == "00000000-0000-4000-8000-000000000001")
        .expect("draft");
    assert_eq!(published["pr"]["state"], "published");
    let edit = harness
        .call(
            "companion/review/draft/delete",
            json!({"draftId": "00000000-0000-4000-8000-000000000001", "expectedVersion": published["version"]}),
        )
        .await
        .expect_err("published drafts are read-only");
    assert_eq!(edit["code"], -32_088);
}

#[tokio::test]
async fn submit_reports_partial_failed_and_stale_outcomes() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let submit = |key_suffix: &str, ids: Value, head: &str| {
        json!({"pullRequest": key, "headRevision": head, "verdictActionId": "comment", "body": "Thanks",
               "draftIds": ids, "forwardBothToAgent": true, "idempotencyKey": format!("submit-{key_suffix}")})
    };
    let mut partial = base_fixture();
    partial["submitMode"] = json!("partial");
    harness.set_fixture(&partial);
    put_pr_draft(&harness, &key, "00000000-0000-4000-8000-000000000004", "pr").await;
    put_pr_draft(&harness, &key, "00000000-0000-4000-8000-000000000005", "pr").await;
    let outcome = harness
        .ok(
            "companion/pullRequest/review/submit",
            submit(
                "2",
                json!([
                    "00000000-0000-4000-8000-000000000004",
                    "00000000-0000-4000-8000-000000000005"
                ]),
                "head-1",
            ),
        )
        .await;
    assert_eq!(outcome["drafts"][0]["pr"], "published");
    assert_eq!(outcome["drafts"][1]["pr"], "outdated");

    let mut failing = base_fixture();
    failing["submitMode"] = json!("failed");
    harness.set_fixture(&failing);
    put_pr_draft(&harness, &key, "00000000-0000-4000-8000-000000000006", "pr").await;
    let failed = harness
        .call(
            "companion/pullRequest/review/submit",
            submit(
                "3",
                json!(["00000000-0000-4000-8000-000000000006"]),
                "head-1",
            ),
        )
        .await
        .expect_err("refused");
    assert_eq!(failed["code"], -32_083);
    let drafts = harness
        .ok(
            "companion/review/drafts/read",
            json!({"source": {"kind": "pullRequest", "pullRequest": key}}),
        )
        .await;
    let kept = drafts["drafts"]
        .as_array()
        .expect("drafts")
        .iter()
        .find(|draft| draft["id"] == "00000000-0000-4000-8000-000000000006")
        .expect("kept");
    assert_eq!(kept["pr"]["state"], "failed");

    let writes_before = harness.writes("forge.pullRequest.review.submit");
    let mut moved = base_fixture();
    moved["headRevision"] = json!("head-2");
    harness.set_fixture(&moved);
    let stale = harness
        .call(
            "companion/pullRequest/review/submit",
            submit(
                "4",
                json!(["00000000-0000-4000-8000-000000000006"]),
                "head-1",
            ),
        )
        .await
        .expect_err("stale");
    assert_eq!(stale["code"], -32_082);
    assert_eq!(
        harness.writes("forge.pullRequest.review.submit"),
        writes_before
    );
}

#[tokio::test]
async fn a_restart_during_submitting_reopens_as_outcome_unknown_without_a_second_write() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let id = "00000000-0000-4000-8000-0000000000aa";
    put_pr_draft(&harness, &key, id, "pr").await;
    // An earlier companion process journaled the run and moved the draft to
    // submitting, then stopped before the plugin answered.
    let (pull_request, _) = companion_core::forge::ids::PullRequestKey::parse(&key).expect("key");
    let earlier = companion_core::forge::actions::Journal::new(harness.store.clone());
    assert!(matches!(
        earlier
            .begin(
                "submit-crash",
                companion_core::forge::actions::RunKind::Submit,
                &pull_request,
                "comment"
            )
            .expect("begin"),
        companion_core::forge::actions::Begin::Run(_)
    ));
    harness
        .review
        .drafts()
        .update_axes(&[id.to_owned()], "2026-10-21T00:00:00Z", |_, routing| {
            if let companion_core::review::drafts::Routing::Pr { pr } = routing {
                pr.state = companion_core::review::drafts::PrState::Submitting;
            }
        })
        .expect("submitting");
    let drafts = harness
        .ok(
            "companion/review/drafts/read",
            json!({"source": {"kind": "pullRequest", "pullRequest": key}}),
        )
        .await;
    assert_eq!(drafts["drafts"][0]["pr"]["state"], "failed");
    assert_eq!(drafts["drafts"][0]["pr"]["error"], "outcomeUnknown");
    let retried = harness
        .call(
            "companion/pullRequest/review/submit",
            json!({"pullRequest": key, "headRevision": "head-1", "verdictActionId": "comment", "body": null,
                   "draftIds": [id], "forwardBothToAgent": false, "idempotencyKey": "submit-crash"}),
        )
        .await
        .expect_err("unknown outcome");
    assert_eq!(retried["data"]["kind"], "outcomeUnknown");
    assert_eq!(harness.writes("forge.pullRequest.review.submit"), 0);
}

#[tokio::test]
async fn viewed_marks_go_to_the_forge_or_stay_on_this_companion() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let forge = harness
        .ok(
            "companion/pullRequest/viewed/set",
            json!({"pullRequest": key, "headRevision": "head-1", "path": "src/a.rs", "viewed": true}),
        )
        .await;
    assert_eq!(forge["source"], "forge");
    assert_eq!(harness.writes("forge.pullRequest.viewed.set"), 1);
    let mut local = base_fixture();
    local["viewed"] = json!(false);
    harness.set_fixture(&local);
    let marked = harness
        .ok(
            "companion/pullRequest/viewed/set",
            json!({"pullRequest": key, "headRevision": "head-1", "path": "src/a.rs", "viewed": true}),
        )
        .await;
    assert_eq!(marked["source"], "companion");
    assert_eq!(
        harness.writes("forge.pullRequest.viewed.set"),
        1,
        "no forge write"
    );
    let files = harness
        .ok(
            "companion/pullRequest/files/read",
            json!({"pullRequest": key, "headRevision": "head-1", "cursor": null}),
        )
        .await;
    assert_eq!(
        files["files"][0]["viewed"],
        json!({"viewed": true, "source": "companion"})
    );
}

#[tokio::test]
async fn submit_claims_drafts_atomically_against_a_second_submit_and_edits() {
    let mut fixture = base_fixture();
    fixture["submitMode"] = json!("slow");
    let harness = Harness::start(&fixture);
    harness.link().await;
    let key = harness.pull_request().await;
    let id = "00000000-0000-4000-8000-0000000000c1";
    let draft = put_pr_draft(&harness, &key, id, "pr").await;
    let submit = |suffix: &str| {
        json!({"pullRequest": key, "headRevision": "head-1", "verdictActionId": "comment", "body": null,
               "draftIds": [id], "forwardBothToAgent": false, "idempotencyKey": format!("race-{suffix}")})
    };
    let edit = async {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        let edited = harness
            .call(
                "companion/review/draft/delete",
                json!({"draftId": id, "expectedVersion": draft["version"]}),
            )
            .await;
        let second = harness
            .call("companion/pullRequest/review/submit", submit("b"))
            .await;
        (edited, second)
    };
    let (first, (edited, second)) = tokio::join!(
        harness.call("companion/pullRequest/review/submit", submit("a")),
        edit
    );
    assert_eq!(first.expect("first submit")["drafts"][0]["pr"], "published");
    assert_eq!(edited.expect_err("delete during submit")["code"], -32_088);
    let second = second.expect_err("the draft is already claimed");
    assert!(
        second["code"] == -32_088 || second["code"] == -32_602,
        "{second}"
    );
    assert_eq!(
        harness.writes("forge.pullRequest.review.submit"),
        1,
        "published once"
    );
    let records = harness.forge.context().journal.records().expect("journal");
    assert!(
        records
            .iter()
            .all(|record| record.state != companion_core::forge::actions::RunState::Started),
        "every journaled run is terminal"
    );
}

#[tokio::test]
async fn pages_off_the_pull_request_host_are_never_returned() {
    let mut fixture = base_fixture();
    fixture["webUrl"] = json!("https://evil.example/octo/repo/7");
    let harness = Harness::start(&fixture);
    harness.link().await;
    let page = harness
        .ok(
            "companion/pullRequests/list",
            json!({"category": "authored", "repository": null, "cursor": null}),
        )
        .await;
    assert_eq!(page["sections"][0]["rows"][0]["webUrl"], "");
    let key = harness.pull_request().await;
    let overview = harness
        .ok("companion/pullRequest/read", json!({"pullRequest": key}))
        .await;
    assert_eq!(overview["webUrl"], "");
    put_pr_draft(&harness, &key, "00000000-0000-4000-8000-000000000001", "pr").await;
    let outcome = harness
        .ok(
            "companion/pullRequest/review/submit",
            json!({"pullRequest": key, "headRevision": "head-1", "verdictActionId": "comment", "body": "Thanks",
                   "draftIds": ["00000000-0000-4000-8000-000000000001"], "forwardBothToAgent": false,
                   "idempotencyKey": "submit-offhost"}),
        )
        .await;
    assert_eq!(harness.writes("forge.pullRequest.review.submit"), 1);
    assert_eq!(outcome["reviewUrl"], Value::Null);
}

#[tokio::test]
async fn an_action_run_opens_only_a_page_on_the_pull_request_host() {
    for (url, kept) in [
        ("https://forge.test/octo/repo/7", true),
        ("https://evil.example/octo/repo/7", false),
        ("http://forge.test/octo/repo/7", false),
    ] {
        let mut fixture = base_fixture();
        fixture["actionOpenUrl"] = json!(url);
        let harness = Harness::start(&fixture);
        harness.link().await;
        let key = harness.pull_request().await;
        let ran = harness
            .ok(
                "companion/pullRequest/action/run",
                json!({"pullRequest": key, "actionId": "merge", "headRevision": "head-1", "input": null,
                       "confirmation": "destructive", "idempotencyKey": format!("open-{url}")}),
            )
            .await;
        assert_eq!(ran["message"], "Finish on the forge");
        assert_eq!(
            ran["openUrl"],
            if kept { json!(url) } else { Value::Null },
            "{url}"
        );
    }
}

#[tokio::test]
async fn submit_rejects_a_repeated_draft_without_writing() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let id = "00000000-0000-4000-8000-000000000001";
    put_pr_draft(&harness, &key, id, "pr").await;
    let repeated = harness
        .call(
            "companion/pullRequest/review/submit",
            json!({"pullRequest": key, "headRevision": "head-1", "verdictActionId": "comment", "body": null,
                   "draftIds": [id, id], "forwardBothToAgent": false, "idempotencyKey": "submit-repeat"}),
        )
        .await
        .expect_err("repeated draft ids");
    assert_eq!(repeated["code"], -32_602);
    assert_eq!(harness.writes("forge.pullRequest.review.submit"), 0);
    let outcome = harness
        .ok(
            "companion/pullRequest/review/submit",
            json!({"pullRequest": key, "headRevision": "head-1", "verdictActionId": "comment", "body": null,
                   "draftIds": [id], "forwardBothToAgent": false, "idempotencyKey": "submit-once"}),
        )
        .await;
    assert_eq!(harness.writes("forge.pullRequest.review.submit"), 1);
    assert_eq!(outcome["drafts"].as_array().map(Vec::len), Some(1));
}
