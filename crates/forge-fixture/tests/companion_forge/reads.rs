//! Reads, degraded accounts and the provider rollback switch.

use serde_json::Value;
use serde_json::json;

use crate::support::*;

fn default_search_query() -> Value {
    json!({
        "text": "",
        "category": "reviewRequested",
        "repositories": {"include": [], "exclude": []},
        "authors": {"include": [], "exclude": []},
        "assignees": {"include": [], "exclude": []},
        "reviewers": {"include": [], "exclude": []},
        "review": {"include": [], "exclude": []},
        "states": {"include": ["open"], "exclude": []},
        "checks": {"include": [], "exclude": []},
        "labels": {"include": [], "exclude": []},
        "baseBranches": {"include": [], "exclude": []},
        "headBranches": {"include": [], "exclude": []},
        "sort": {"field": "updated", "direction": "descending"}
    })
}

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
        (
            &github["forgeName"],
            &github["defaultHost"],
            &github["icon"]
        ),
        (&json!("github"), &Value::Null, &Value::Null),
        "a provider that never initialized has no declared identity"
    );
    let fixture = providers
        .iter()
        .find(|provider| provider["pluginId"] == "fixture")
        .expect("fixture provider");
    assert_eq!(fixture["forgeName"], "Fixture Forge");
    assert_eq!(
        fixture["icon"],
        json!({"kind": "glyph", "viewBox": "0 0 24 24", "path": "M2 2L22 22Z"}),
        "the plugin's own glyph, validated by the companion"
    );
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
    assert_eq!(
        row.get("reviewThreadId"),
        Some(&Value::Null),
        "a row without a canonical review chat says so explicitly"
    );
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
async fn structured_search_reaches_the_selected_provider_without_dropping_fields() {
    let harness = Harness::start(&base_fixture());
    let account = harness.link().await;
    let query = json!({
        "text": "parser",
        "category": "all",
        "repositories": {"include": ["octo/repo"], "exclude": []},
        "authors": {"include": ["someone"], "exclude": ["bot"]},
        "assignees": {"include": [], "exclude": []},
        "reviewers": {"include": [], "exclude": []},
        "review": {"include": ["changesRequested"], "exclude": []},
        "states": {"include": ["open"], "exclude": ["draft"]},
        "checks": {"include": ["failing"], "exclude": []},
        "labels": {"include": ["bug"], "exclude": []},
        "baseBranches": {"include": ["main"], "exclude": []},
        "headBranches": {"include": [], "exclude": []},
        "sort": {"field": "updated", "direction": "descending"}
    });

    let page = harness
        .ok(
            "companion/pullRequests/search",
            json!({
                "accounts": [account],
                "providerIds": ["fixture"],
                "query": query,
                "cursor": null
            }),
        )
        .await;

    assert_eq!(page["category"], "all");
    assert_eq!(page["sections"][0]["rows"][0]["repository"], "octo/repo");
    let traffic = harness.lines("traffic.jsonl");
    let request = traffic
        .iter()
        .find(|frame| frame["in"]["method"] == "forge.pullRequests.search")
        .expect("search request");
    assert_eq!(request["in"]["params"]["query"], query);
}

#[tokio::test]
async fn a_legacy_provider_serves_only_queries_the_list_contract_can_preserve() {
    let mut fixture = base_fixture();
    fixture["noSearch"] = json!(true);
    let harness = Harness::start(&fixture);
    let account = harness.link().await;
    let query = default_search_query();

    let page = harness
        .ok(
            "companion/pullRequests/search",
            json!({
                "accounts": [account],
                "providerIds": ["fixture"],
                "query": query,
                "cursor": null
            }),
        )
        .await;

    assert_eq!(page["sections"][0]["rows"][0]["repository"], "octo/repo");
    assert_eq!(harness.plugin_requests("forge.pullRequests.list"), 1);
    assert_eq!(harness.plugin_requests("forge.pullRequests.search"), 0);

    let mut filtered = default_search_query();
    filtered["authors"]["include"] = json!(["someone"]);
    let unavailable = harness
        .call(
            "companion/pullRequests/search",
            json!({
                "accounts": [account],
                "providerIds": ["fixture"],
                "query": filtered,
                "cursor": null
            }),
        )
        .await
        .expect_err("unsupported filtered search");
    assert_eq!(unavailable["code"], -32_084);
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
    assert_eq!(
        activity["items"]
            .as_array()
            .expect("items")
            .iter()
            .map(|item| item["id"].as_str().expect("id"))
            .collect::<Vec<_>>(),
        ["r1", "c1"],
        "activity reaches the client newest first, as the plugin sent it"
    );
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
async fn a_files_page_with_a_path_less_file_is_refused() {
    let mut fixture = base_fixture();
    fixture["files"] = json!([{"path": "src/a.rs", "patch": PATCH}, {"path": "", "patch": PATCH}]);
    let harness = Harness::start(&fixture);
    harness.link().await;
    let key = harness.pull_request().await;
    let refused = harness
        .call(
            "companion/pullRequest/files/read",
            json!({"pullRequest": key, "headRevision": "head-1", "cursor": null}),
        )
        .await
        .expect_err("a file without a path");
    assert_eq!(refused["code"], -32_603);
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

fn provider_card<'a>(directory: &'a Value, plugin_id: &str) -> &'a Value {
    directory["providers"]
        .as_array()
        .expect("providers")
        .iter()
        .find(|provider| provider["pluginId"] == plugin_id)
        .expect("provider card")
}

fn install_external(harness: &Harness, id: &str, executable: &std::path::Path) {
    companion_core::forge::registry::PluginRegistry::new(harness.root.join("forge-plugins.json"))
        .install(companion_core::forge::registry::ExternalPlugin {
            id: id.into(),
            executable: executable.to_path_buf(),
            args: vec!["--id".into(), id.into()],
            priority: 5,
        })
        .expect("install");
}

#[tokio::test]
async fn every_directory_read_reports_whether_a_registered_plugin_is_installed() {
    let harness = Harness::start(&base_fixture());
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(
        provider_card(&directory, "fixture")["installation"],
        json!({"state": "installed"})
    );
    let copy = harness.root.join("copied-plugin");
    std::fs::copy(FIXTURE, &copy).expect("copy plugin");
    install_external(&harness, "copied", &copy);
    std::fs::remove_file(&copy).expect("remove plugin");
    let missing = harness.ok("companion/forge/accounts/read", json!({})).await;
    let card = provider_card(&missing, "copied");
    assert_eq!(card["installation"]["state"], "missing");
    assert!(
        card["installation"]["reason"]
            .as_str()
            .is_some_and(|reason| !reason.is_empty())
    );
    assert_eq!(card["authMethods"], json!([]));
    std::fs::copy(FIXTURE, &copy).expect("restore plugin");
    let restored = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(
        provider_card(&restored, "copied")["installation"],
        json!({"state": "installed"})
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_plugin_that_cannot_initialize_is_reported_as_failed() {
    use std::os::unix::fs::PermissionsExt;

    let harness = Harness::start(&base_fixture());
    let broken = harness.root.join("broken-plugin");
    std::fs::write(&broken, "#!/bin/sh\nexit 3\n").expect("script");
    std::fs::set_permissions(&broken, std::fs::Permissions::from_mode(0o755)).expect("mode");
    install_external(&harness, "broken", &broken);
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    let card = provider_card(&directory, "broken");
    assert_eq!(card["installation"]["state"], "failed");
    assert!(
        card["installation"]["reason"]
            .as_str()
            .is_some_and(|reason| !reason.is_empty())
    );
    assert_eq!(
        provider_card(&directory, "fixture")["installation"],
        json!({"state": "installed"})
    );
}

#[tokio::test]
async fn an_excluded_account_leaves_the_catalog_and_keeps_its_link() {
    let harness = Harness::start(&base_fixture());
    let account = harness.link().await;
    let key = harness.pull_request().await;
    let excluded = harness
        .ok(
            "companion/forge/account/setEnabled",
            json!({"account": account, "enabled": false}),
        )
        .await;
    assert_eq!(excluded["account"]["account"], account.as_str());
    assert_eq!(excluded["account"]["catalogEnabled"], false);
    let list = harness
        .ok(
            "companion/pullRequests/list",
            json!({"category": "reviewRequested", "repository": null, "cursor": null}),
        )
        .await;
    assert_eq!(list["sections"], json!([]));
    let search = harness
        .ok(
            "companion/pullRequests/search",
            json!({"query": default_search_query(), "cursor": null}),
        )
        .await;
    assert_eq!(search["sections"], json!([]));
    let directory = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(directory["accounts"][0]["account"], account.as_str());
    assert_eq!(directory["accounts"][0]["catalogEnabled"], false);
    assert_eq!(directory["accounts"][0]["state"], "connected");
    let overview = harness
        .ok("companion/pullRequest/read", json!({"pullRequest": key}))
        .await;
    assert_eq!(overview["account"]["login"], "octocat");
    // A repeated sign-in of the same login keeps the user's choice.
    harness.link().await;
    let relinked = harness.ok("companion/forge/accounts/read", json!({})).await;
    assert_eq!(relinked["accounts"][0]["catalogEnabled"], false);
    harness
        .ok(
            "companion/forge/account/setEnabled",
            json!({"account": account, "enabled": true}),
        )
        .await;
    assert_eq!(harness.pull_request().await, key);
}

#[tokio::test]
async fn toggling_an_unknown_account_is_not_found() {
    let harness = Harness::start(&base_fixture());
    let account = harness.link().await;
    harness
        .ok(
            "companion/forge/account/disconnect",
            json!({"account": account, "mode": "unlink", "confirmation": "none"}),
        )
        .await;
    let missing = harness
        .call(
            "companion/forge/account/setEnabled",
            json!({"account": account, "enabled": false}),
        )
        .await
        .expect_err("unlinked");
    assert_eq!(missing["code"], -32_088);
    let malformed = harness
        .call(
            "companion/forge/account/setEnabled",
            json!({"account": "not-an-account", "enabled": false}),
        )
        .await
        .expect_err("malformed");
    assert_eq!(malformed["code"], -32_602);
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
