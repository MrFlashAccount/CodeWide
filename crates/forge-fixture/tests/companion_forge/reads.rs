//! Reads, degraded accounts and the provider rollback switch.

use serde_json::json;

use crate::support::*;

#[tokio::test]
async fn the_directory_lists_built_in_and_external_providers_with_sanitized_methods() {
    let harness = Harness::start(&base_fixture());
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    let providers = directory["providers"].as_array().expect("providers");
    let github = providers
        .iter()
        .find(|provider| provider["pluginId"] == "github")
        .expect("github is always registered");
    assert_eq!(github["builtIn"], true);
    assert_eq!(
        github["authMethods"],
        json!([]),
        "no bundled binary: unavailable"
    );
    assert_eq!(
        github["defaultHost"], "github.com",
        "a built-in provider names its host without spawning"
    );
    let fixture = providers
        .iter()
        .find(|provider| provider["pluginId"] == "fixture")
        .expect("fixture provider");
    assert_eq!(fixture["icon"]["glyph"]["path"], "M2 2L22 22Z");
    assert_eq!(fixture["defaultHost"], "forge.test");
    let paste = fixture["authMethods"]
        .as_array()
        .expect("methods")
        .iter()
        .find(|method| method["kind"] == "pasteToken")
        .expect("paste");
    assert_eq!(
        paste["links"],
        json!([{"label": "Generate token", "url": "https://forge.test/settings/tokens"}]),
        "links off the provider host are dropped"
    );
}

#[tokio::test]
async fn the_list_and_atomic_overview_carry_keys_states_and_a_validated_catalog() {
    let harness = Harness::start(&base_fixture());
    let account = harness.link().await;
    let page = harness
        .ok(
            "companion/pullRequests/list",
            json!({"category": "reviewRequested", "repository": null, "cursor": null}),
        )
        .await;
    let section = &page["sections"][0];
    assert_eq!(section["account"]["account"], account.as_str());
    assert_eq!(section["account"]["state"], "connected");
    assert_eq!(section["account"]["credentialSource"], "arcToken");
    let row = &section["rows"][0];
    assert!(
        row["pullRequest"]
            .as_str()
            .expect("key")
            .starts_with("fpr1.")
    );
    assert_eq!(page["repositories"], json!(["octo/repo"]));
    let key = row["pullRequest"].clone();
    let overview = harness
        .ok("companion/pullRequest/read", json!({"pullRequest": key}))
        .await;
    assert_eq!(overview["headRevision"], "head-1");
    assert_eq!(overview["checks"]["state"], "failing");
    let actions: Vec<&str> = overview["catalog"]["actions"]
        .as_array()
        .expect("actions")
        .iter()
        .filter_map(|action| action["actionId"].as_str())
        .collect();
    assert!(actions.contains(&"merge"));
    assert!(
        actions.contains(&"teleport"),
        "unknown kinds stay as extensions"
    );
    assert!(
        !actions.contains(&"broken"),
        "disabled without a reason is dropped"
    );
    assert!(actions.contains(&"codewide.scenario.reviewPr"));
    let teleport = overview["catalog"]["actions"]
        .as_array()
        .expect("actions")
        .iter()
        .find(|action| action["actionId"] == "teleport")
        .expect("teleport");
    assert_eq!(teleport["kind"], "extension");
    assert_eq!(teleport["placement"], "overflow");
    let fix_ci = overview["catalog"]["actions"]
        .as_array()
        .expect("actions")
        .iter()
        .find(|action| action["actionId"] == "codewide.scenario.fixCi")
        .expect("fixCi");
    assert_eq!(fix_ci["availability"]["state"], "disabled");
    assert_eq!(
        fix_ci["availability"]["reason"],
        "No local checkout of this branch on the companion"
    );
}

#[tokio::test]
async fn activity_files_hunks_and_badges_answer_from_the_fixture_plugin() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let activity = harness
        .ok(
            "companion/pullRequest/activity/read",
            json!({"pullRequest": key, "cursor": null}),
        )
        .await;
    assert_eq!(activity["items"][0]["author"], "reviewer");
    let files = harness
        .ok(
            "companion/pullRequest/files/read",
            json!({"pullRequest": key, "headRevision": "head-1", "cursor": null}),
        )
        .await;
    let file = &files["files"][0];
    assert_eq!(file["patch"]["state"], "present");
    assert_eq!(file["patch"]["hunks"][0]["id"], "src/a.rs#h1");
    assert_eq!(file["viewed"]["source"], "forge");
    let stale = harness
        .call(
            "companion/pullRequest/files/read",
            json!({"pullRequest": key, "headRevision": "old", "cursor": null}),
        )
        .await
        .expect_err("stale");
    assert_eq!(stale["code"], -32_082);
    assert_eq!(stale["data"]["headRevision"], "head-1");
    let hunks = harness
        .ok(
            "companion/review/hunks/read",
            json!({"source": {"kind": "pullRequest", "pullRequest": key}, "revision": "head-1"}),
        )
        .await;
    assert_eq!(hunks["revision"], "head-1");
    assert_eq!(hunks["files"][0]["hunks"][0]["ordinal"], 1);
    let links = harness
        .ok(
            "companion/pullRequestLinks/read",
            json!({"threadIds": ["thread-1"]}),
        )
        .await;
    assert_eq!(links["threads"][0]["pullRequests"], json!([]));
}

#[tokio::test]
async fn a_disabled_provider_answers_locally_and_keeps_its_accounts() {
    let harness = Harness::start(&base_fixture());
    harness.link().await;
    let key = harness.pull_request().await;
    let disabled = harness
        .ok(
            "companion/forge/provider/setEnabled",
            json!({"pluginId": "fixture", "enabled": false}),
        )
        .await;
    assert_eq!(disabled["provider"]["enabled"], false);
    let unavailable = harness
        .call("companion/pullRequest/read", json!({"pullRequest": key}))
        .await
        .expect_err("disabled");
    assert_eq!(unavailable["code"], -32_080);
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(directory["accounts"].as_array().map(Vec::len), Some(1));
    harness
        .ok(
            "companion/forge/provider/setEnabled",
            json!({"pluginId": "fixture", "enabled": true}),
        )
        .await;
    let overview = harness
        .ok("companion/pullRequest/read", json!({"pullRequest": key}))
        .await;
    assert_eq!(overview["account"]["login"], "octocat");
}

#[tokio::test]
async fn a_missing_checks_credential_degrades_only_checks() {
    let mut fixture = base_fixture();
    fixture["checksCredential"] = json!(false);
    let harness = Harness::start(&fixture);
    harness.link().await;
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    let provider = directory["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .find(|provider| provider["pluginId"] == "fixture")
        .expect("fixture");
    assert_eq!(provider["checksCredential"]["state"], "missing");
    let key = harness.pull_request().await;
    let overview = harness
        .ok("companion/pullRequest/read", json!({"pullRequest": key}))
        .await;
    assert_eq!(
        overview["checks"],
        json!({"state": "unavailable", "reason": "The CI token is missing"})
    );
    assert_eq!(overview["checkItems"], json!([]));
    assert_eq!(overview["title"], "Fix the parser");
}

#[tokio::test]
async fn an_expired_account_degrades_only_its_own_section() {
    let mut fixture = base_fixture();
    fixture["hostLogins"] = json!(["octocat", "hubot"]);
    let harness = Harness::start(&fixture);
    harness.link().await;
    harness
        .ok(
            "companion/forge/auth/start",
            json!({"pluginId": "fixture", "methodId": "existing", "host": "forge.test", "login": "hubot", "idempotencyKey": "link-2"}),
        )
        .await;
    fixture["expiredLogins"] = json!(["hubot"]);
    harness.set_fixture(&fixture);
    let page = harness
        .ok(
            "companion/pullRequests/list",
            json!({"category": "authored", "repository": null, "cursor": null}),
        )
        .await;
    let sections = page["sections"].as_array().expect("sections");
    let hubot = sections
        .iter()
        .find(|section| section["account"]["login"] == "hubot")
        .expect("hubot");
    assert_eq!(hubot["account"]["state"], "expired");
    assert_eq!(hubot["rows"], json!([]));
    let octocat = sections
        .iter()
        .find(|section| section["account"]["login"] == "octocat")
        .expect("octocat");
    assert_eq!(octocat["rows"].as_array().map(Vec::len), Some(1));
}
