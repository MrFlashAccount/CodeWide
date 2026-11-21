//! Account connection: host login flows, pasted tokens and disconnect.

use std::time::Duration;

use serde_json::json;

use crate::support::*;

#[tokio::test]
async fn host_login_links_after_a_poll_and_cancel_or_expiry_end_the_flow() {
    let mut fixture = base_fixture();
    fixture["hostLogin"] = json!({"mode": "complete", "login": "hubot"});
    let harness = Harness::start(&fixture);
    let started = harness
        .ok(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "login", "host": "forge.test", "login": null, "idempotencyKey": "flow-1"}),
        )
        .await;
    assert_eq!(started["kind"], "flow");
    assert_eq!(started["flow"]["userCode"], "ABCD-1234");
    let repeated = harness
        .ok(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "login", "host": "forge.test", "login": null, "idempotencyKey": "flow-2"}),
        )
        .await;
    assert_eq!(
        repeated["flow"]["flowId"], started["flow"]["flowId"],
        "one active flow per provider and host"
    );
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(directory["flows"].as_array().map(Vec::len), Some(1));
    tokio::time::sleep(Duration::from_secs(7)).await;
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(directory["flows"], json!([]));
    assert!(
        directory["accounts"]
            .as_array()
            .expect("accounts")
            .iter()
            .any(|account| account["login"] == "hubot")
    );

    let mut expiring = base_fixture();
    expiring["hostLogin"] = json!({"mode": "pending", "login": "x", "expiresInSeconds": 1});
    harness.set_fixture(&expiring);
    harness
        .ok(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "login", "host": "forge.test", "login": null, "idempotencyKey": "flow-3"}),
        )
        .await;
    tokio::time::sleep(Duration::from_millis(1_600)).await;
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    let expired = &directory["flows"][0];
    assert_eq!(
        expired["state"], "failed",
        "an expired flow stays visible as failed"
    );
    assert_eq!(expired["retryable"], true);
    assert!(
        expired["reason"]
            .as_str()
            .expect("reason")
            .contains("expired")
    );
    assert!(
        expired.get("userCode").is_none(),
        "a failed flow carries no code"
    );

    let cancelled = harness
        .ok(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "login", "host": "forge.test", "login": null, "idempotencyKey": "flow-4"}),
        )
        .await;
    harness
        .ok(
            "companion/forge/auth/cancel",
            json!({"flowId": cancelled["flow"]["flowId"]}),
        )
        .await;
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(directory["flows"], json!([]));
}

#[tokio::test]
async fn pasted_tokens_travel_once_and_disconnect_modes_are_enforced() {
    let harness = Harness::start(&base_fixture());
    let invalid = harness
        .call(
            "companion/forge/auth/submitToken",
            json!({"pluginId": "fixture", "host": "forge.test", "token": "bad-sentinel-token", "idempotencyKey": "paste-1"}),
        )
        .await
        .expect_err("invalid");
    assert_eq!(invalid["code"], -32_081);
    assert!(
        !invalid.to_string().contains("bad-sentinel-token"),
        "{invalid}"
    );
    let linked = harness
        .ok(
            "companion/forge/auth/submitToken",
            json!({"pluginId": "fixture", "host": "forge.test", "token": "valid-sentinel-token", "idempotencyKey": "paste-2"}),
        )
        .await;
    assert_eq!(linked["account"]["credentialSource"], "savedToken");
    assert!(!linked.to_string().contains("valid-sentinel-token"));
    let account = linked["account"]["account"].clone();
    let unlink = harness
        .call(
            "companion/forge/account/disconnect",
            json!({"account": account, "mode": "unlink", "confirmation": "none"}),
        )
        .await
        .expect_err("saved tokens need forgetToken");
    assert_eq!(unlink["code"], -32_602);
    harness.link().await;
    let octocat = harness.ok("companion/forge/accounts/read", json!({})).await["accounts"]
        .as_array()
        .expect("accounts")
        .iter()
        .find(|account| account["login"] == "octocat")
        .expect("octocat")["account"]
        .clone();
    let logout = harness
        .call(
            "companion/forge/account/disconnect",
            json!({"account": octocat, "mode": "logoutHost", "confirmation": "none"}),
        )
        .await
        .expect_err("logoutHost needs destructive confirmation");
    assert_eq!(logout["code"], -32_089);
    assert_eq!(harness.writes("auth.disconnect"), 0, "nothing ran");
    harness
        .ok(
            "companion/forge/account/disconnect",
            json!({"account": octocat, "mode": "unlink", "confirmation": "none"}),
        )
        .await;
    assert_eq!(
        harness.writes("auth.disconnect"),
        0,
        "unlink never touches the host"
    );
    harness
        .ok(
            "companion/forge/account/disconnect",
            json!({"account": account, "mode": "forgetToken", "confirmation": "none"}),
        )
        .await;
    assert_eq!(harness.writes("auth.disconnect"), 1);
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(directory["accounts"], json!([]));
    let traffic = std::fs::read_to_string(harness.state().join("traffic.jsonl")).expect("traffic");
    let carrying: Vec<&str> = traffic
        .lines()
        .filter(|line| line.contains("valid-sentinel-token"))
        .collect();
    assert_eq!(carrying.len(), 1, "only the inbound auth.start carries it");
    assert!(carrying[0].contains("\"in\"") && carrying[0].contains("auth.start"));
    let events = harness.events.lock().expect("events").clone();
    assert!(
        events
            .iter()
            .all(|event| !event.to_string().contains("sentinel-token"))
    );
}

#[tokio::test]
async fn a_host_login_that_fails_after_the_code_reports_its_reason_until_dismissed() {
    let mut fixture = base_fixture();
    fixture["hostLogin"] = json!({"mode": "failed", "login": "x"});
    let harness = Harness::start(&fixture);
    let started = harness
        .ok(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "login", "host": "forge.test", "login": null, "idempotencyKey": "fail-1"}),
        )
        .await;
    assert_eq!(started["flow"]["state"], "awaitingUser");
    assert_eq!(started["flow"]["userCode"], "ABCD-1234");
    tokio::time::sleep(Duration::from_secs(7)).await;
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    let flow = &directory["flows"][0];
    assert_eq!(flow["flowId"], started["flow"]["flowId"]);
    assert_eq!(flow["state"], "failed");
    assert_eq!(flow["reason"], "The host login was denied");
    assert_eq!(flow["retryable"], false);
    assert_eq!(directory["accounts"], json!([]));
    harness
        .ok(
            "companion/forge/auth/cancel",
            json!({"flowId": flow["flowId"]}),
        )
        .await;
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(
        directory["flows"],
        json!([]),
        "cancel dismisses a failed flow"
    );
}

#[tokio::test]
async fn auth_accepts_only_the_declared_host_and_saved_tokens_only_forget() {
    let harness = Harness::start(&base_fixture());
    let foreign = harness
        .call(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "existing", "host": "evil.example", "login": "octocat", "idempotencyKey": "h1"}),
        )
        .await
        .expect_err("undeclared host");
    assert_eq!(foreign["code"], -32_602);
    let foreign_token = harness
        .call(
            "companion/forge/auth/submitToken",
            json!({"pluginId": "fixture", "host": "evil.example", "token": "valid-sentinel-token", "idempotencyKey": "h2"}),
        )
        .await
        .expect_err("undeclared host");
    assert_eq!(foreign_token["code"], -32_602);
    assert_eq!(
        harness.plugin_requests("auth.start"),
        0,
        "nothing reached the plugin"
    );
    let linked = harness
        .ok(
            "companion/forge/auth/submitToken",
            json!({"pluginId": "fixture", "host": "forge.test", "token": "valid-sentinel-token", "idempotencyKey": "h3"}),
        )
        .await;
    let logout = harness
        .call(
            "companion/forge/account/disconnect",
            json!({"account": linked["account"]["account"], "mode": "logoutHost", "confirmation": "destructive"}),
        )
        .await
        .expect_err("a saved token is removed only with forgetToken");
    assert_eq!(logout["code"], -32_602);
    assert_eq!(harness.writes("auth.disconnect"), 0);
}

#[tokio::test]
async fn concurrent_host_login_starts_share_one_flow() {
    let mut fixture = base_fixture();
    fixture["hostLogin"] = json!({"mode": "pending", "login": "x"});
    let harness = Harness::start(&fixture);
    let start = |key: &str| json!({"pluginId": "fixture", "methodId": "login", "host": "forge.test", "login": null, "idempotencyKey": key});
    let (first, second) = tokio::join!(
        harness.call("companion/forge/auth/start", start("c1")),
        harness.call("companion/forge/auth/start", start("c2"))
    );
    let started: Vec<_> = [first, second].into_iter().filter_map(Result::ok).collect();
    assert!(!started.is_empty());
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(
        directory["flows"].as_array().map(Vec::len),
        Some(1),
        "one flow per provider and host"
    );
    assert_eq!(
        harness.plugin_requests("auth.start"),
        1,
        "one host login was spawned"
    );
}
