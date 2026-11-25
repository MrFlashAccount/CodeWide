use forge_protocol::methods;
use serde_json::{Value, json};

use crate::support::*;

const READ: &str = "companion/pullRequest/checkTriggers/read";
const RUN: &str = "companion/pullRequest/action/run";

fn trigger(id: &str, label: &str, check: &str) -> Value {
    json!({"actionId": id, "kind": "manualTrigger", "group": "jobs", "label": label,
           "availability": {"state": "enabled"}, "confirm": "none", "anchor": {"kind": "checks", "checkId": check},
           "toggle": null, "input": null, "order": 0, "placement": "secondary", "isDefault": false})
}

fn start(pr: &str, id: &str, check: &str, key: &str) -> Value {
    json!({"pullRequest":pr, "headRevision":"head-1", "triggerCheckId":check, "actionId":id,
           "confirmation":"none", "input":null, "idempotencyKey":key})
}

#[tokio::test]
async fn discover_on_demand_and_run_only_current_jobs_within_the_selected_check() {
    let mut fixture = base_fixture();
    let mut disabled = trigger("z", "Not startable", "ci-1");
    disabled["availability"] = json!({"state":"disabled","reason":"Already started"});
    fixture["checkTriggers"] = json!([
        trigger("a", "Run UI tests", "ci-1"),
        trigger("b", "Custom label", "ci-1"),
        trigger("c", "Run integration", "ci-2"),
        disabled
    ]);
    let harness = Harness::start(&fixture);
    harness.link().await;
    let pr = harness.pull_request().await;
    harness
        .ok("companion/pullRequest/read", json!({"pullRequest":pr}))
        .await;
    assert_eq!(
        harness.plugin_requests(methods::PULL_REQUEST_CHECK_TRIGGERS),
        0
    );
    let catalog = harness
        .ok(READ, json!({"pullRequest":pr, "headRevision":"head-1"}))
        .await;
    let labels: Vec<_> = catalog["actions"]
        .as_array()
        .expect("actions")
        .iter()
        .map(|action| action["label"].as_str().expect("label"))
        .collect();
    assert_eq!(labels, ["Run UI tests", "Custom label", "Run integration"]);
    let a = start(&pr, "a", "ci-1", "start-a");
    let b = start(&pr, "b", "ci-1", "start-b");
    let mut unscoped = a.clone();
    unscoped
        .as_object_mut()
        .expect("request")
        .remove("triggerCheckId");
    for invalid in [
        unscoped,
        start(&pr, "z", "ci-1", "start-disabled"),
        start(&pr, "c", "ci-1", "start-other"),
        start(&pr, "merge", "ci-1", "start-standard"),
    ] {
        assert!(harness.call(RUN, invalid).await.is_err());
    }
    assert_eq!(harness.writes(methods::PULL_REQUEST_ACTION_RUN), 0);
    let receipt = harness.ok(RUN, a.clone()).await;
    assert_eq!(receipt["message"], "Started");
    assert!(receipt["catalog"].is_null());
    assert_eq!(harness.ok(RUN, a).await, receipt);
    assert!(
        harness
            .call(RUN, start(&pr, "a", "ci-2", "start-a"))
            .await
            .is_err()
    );
    harness.ok(RUN, b).await;
    let calls = harness.lines("writes.jsonl");
    let starts: Vec<_> = calls
        .iter()
        .filter(|row| row["method"] == methods::PULL_REQUEST_ACTION_RUN)
        .map(|row| &row["params"])
        .collect();
    assert_eq!(starts.len(), 2);
    for (params, id) in starts.iter().zip(["a", "b"]) {
        assert_eq!(params["actionId"], id);
        assert_eq!(params["triggerCheckId"], "ci-1");
        assert_eq!(params["headRevision"], "head-1");
    }
    fixture["checkTriggers"] = json!([]);
    harness.set_fixture(&fixture);
    assert!(
        harness
            .call(RUN, start(&pr, "a", "ci-1", "start-removed"))
            .await
            .is_err()
    );
    let mut stale = start(&pr, "a", "ci-1", "start-stale");
    stale["headRevision"] = json!("old");
    assert_eq!(
        harness.call(RUN, stale).await.expect_err("stale head")["code"],
        -32_082
    );
    assert_eq!(harness.writes(methods::PULL_REQUEST_ACTION_RUN), 2);
}

#[tokio::test]
async fn an_unconfirmed_write_replays_its_unknown_outcome_without_redispatch() {
    let mut fixture = base_fixture();
    fixture["checkTriggers"] = json!([trigger("a", "My action", "ci-1")]);
    fixture["actionMode"] = json!("lostReply");
    let harness = Harness::start(&fixture);
    harness.link().await;
    let request = start(&harness.pull_request().await, "a", "ci-1", "start-unknown");
    let error = harness
        .call(RUN, request.clone())
        .await
        .expect_err("unconfirmed");
    assert_eq!(error["data"]["kind"], "outcomeUnknown");
    assert_eq!(harness.call(RUN, request).await.expect_err("replay"), error);
    assert_eq!(harness.writes(methods::PULL_REQUEST_ACTION_RUN), 1);
}

#[tokio::test]
async fn provider_without_triggers_does_not_receive_the_read() {
    let mut fixture = base_fixture();
    fixture["hideCapabilities"] = json!(["forge.checkTriggers@1"]);
    let harness = Harness::start(&fixture);
    harness.link().await;
    let pr = harness.pull_request().await;
    let sessions = harness.plugin_requests("initialize");
    let error = harness
        .call(READ, json!({"pullRequest":pr,"headRevision":"head-1"}))
        .await
        .expect_err("unsupported");
    assert_eq!(error["data"]["capability"], "forge.checkTriggers@1");
    assert_eq!(harness.plugin_requests("initialize"), sessions);
    assert_eq!(
        harness.plugin_requests(methods::PULL_REQUEST_CHECK_TRIGGERS),
        0
    );
}
