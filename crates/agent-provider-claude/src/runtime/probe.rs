//! The runtime probe (`probe()` of `host/src/claude/sdkRuntime.ts`): a
//! short-lived `claude` process without a prompt that reports the account,
//! the model list and, best effort, the plan's usage. It makes no model call.
//!
//! The Agent SDK's `supportedModels()` and `initializationResult().account`
//! both read the answer to the `initialize` control request
//! (`SDKControlInitializeResponse`: `models: ModelInfo[]`, `account:
//! AccountInfo`), so the probe sends `initialize` and reads both from it.
//! Account details other than the sign-in state, the plan and the account
//! label (tokens, key sources) never leave this module.

use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::Duration,
};

use agent_core::model::ProviderAccount;
use serde_json::Value;

use super::models::RawModel;
use crate::cli::{
    command::QueryOptions,
    process::{ClaudeProcess, ProcessError},
};

const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const USAGE_READ_TIMEOUT: Duration = Duration::from_secs(5);

/// What one probe learned.
#[derive(Clone, Debug, PartialEq)]
pub struct ProbeResult {
    /// `None` when `initialize` reported no account object.
    pub account: Option<ProviderAccount>,
    /// The valid rows of the model list ([`raw_models`]).
    pub models: Vec<RawModel>,
    /// The raw answer of the usage read (`get_usage`), `None` when it failed,
    /// timed out or `claude` predates it; validated by its reader.
    pub usage: Option<Value>,
}

/// Why a probe learned nothing.
#[derive(Debug, thiserror::Error)]
pub enum ProbeError {
    #[error("Claude probe could not start claude: {0}")]
    Spawn(#[source] ProcessError),
    #[error("Claude probe initialize failed: {0}")]
    Initialize(#[source] ProcessError),
    #[error("Claude probe timed out")]
    Timeout,
    #[error("Claude probe initialize answer has no model list")]
    NoModels,
}

/// Where and how the probe starts `claude`.
#[derive(Clone, Copy, Debug)]
pub struct ProbeLaunch<'a> {
    /// The user's `claude`.
    pub executable: &'a Path,
    /// The working directory of the probe process.
    pub cwd: &'a Path,
    /// Added to the companion's environment: the provider's child
    /// environment and the user's proxy variables
    /// ([`super::proxy_environment::ProxyEnvironment::environment`]).
    pub environment: &'a [(OsString, OsString)],
}

/// Starts `claude` without a session, reads the `initialize` answer (at most
/// 15 s) and then the usage (best effort, at most 5 s), and closes it.
///
/// # Errors
///
/// Returns a spawn or `initialize` failure, the timeout, or an answer
/// without a model list.
pub async fn probe(launch: ProbeLaunch<'_>) -> Result<ProbeResult, ProbeError> {
    let options = QueryOptions::probe(PathBuf::from(launch.executable), PathBuf::from(launch.cwd));
    let (process, mut events) =
        ClaudeProcess::spawn(&options, launch.environment).map_err(ProbeError::Spawn)?;
    // The process stops reading its output once nobody receives its events,
    // and then could not answer requests; the probe needs none of them.
    tokio::spawn(async move { while events.recv().await.is_some() {} });
    let result = read(&process, &options).await;
    process.close().await;
    result
}

async fn read(process: &ClaudeProcess, options: &QueryOptions) -> Result<ProbeResult, ProbeError> {
    let initialization = tokio::time::timeout(
        PROBE_TIMEOUT,
        process.initialize(&options.sdk_mcp_servers()),
    )
    .await
    .map_err(|_| ProbeError::Timeout)?
    .map_err(ProbeError::Initialize)?;
    let models = initialization
        .get("models")
        .and_then(Value::as_array)
        .ok_or(ProbeError::NoModels)?;
    // Best effort: a failed usage read leaves the limits unknown.
    let usage = tokio::time::timeout(USAGE_READ_TIMEOUT, process.read_usage())
        .await
        .ok()
        .and_then(Result::ok);
    Ok(ProbeResult {
        account: initialization.get("account").and_then(account_of),
        models: raw_models(models),
        usage,
    })
}

/// A non-empty string field of `account`.
fn field<'a>(account: &'a Value, key: &str) -> Option<&'a str> {
    account
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
}

/// Signed in when any login detail is present, or authentication is
/// external (a third-party API provider).
#[must_use]
pub fn is_authenticated(account: &Value) -> bool {
    ["subscriptionType", "tokenSource", "apiKeySource", "email"]
        .into_iter()
        .any(|key| field(account, key).is_some())
        || field(account, "apiProvider").is_some_and(|provider| provider != "firstParty")
}

/// The account label (email, else organization), which exists only for an
/// Anthropic login. Shown to the user; never logged.
#[must_use]
pub fn account_label_of(account: &Value) -> Option<&str> {
    match field(account, "apiProvider") {
        None | Some("firstParty") => {
            field(account, "email").or_else(|| field(account, "organization"))
        }
        Some(_) => None,
    }
}

/// The account state of `initialize`'s `account` (`AccountInfo`); `None`
/// when it is not an object.
#[must_use]
pub fn account_of(account: &Value) -> Option<ProviderAccount> {
    if !account.is_object() {
        return None;
    }
    Some(ProviderAccount {
        account_label: account_label_of(account).map(str::to_owned),
        authenticated: is_authenticated(account),
        label: field(account, "subscriptionType").map(str::to_owned),
    })
}

/// The valid rows of `initialize`'s `models` (`ModelInfo[]`): a row needs a
/// string `value` and `displayName`; a missing description reads as empty,
/// non-string effort levels are dropped and an empty `resolvedModel` is
/// absent.
#[must_use]
pub fn raw_models(models: &[Value]) -> Vec<RawModel> {
    models
        .iter()
        .filter_map(|model| {
            let value = model.get("value")?.as_str()?;
            let display_name = model.get("displayName")?.as_str()?;
            Some(RawModel {
                value: value.to_owned(),
                display_name: display_name.to_owned(),
                description: model
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned(),
                resolved_model: model
                    .get("resolvedModel")
                    .and_then(Value::as_str)
                    .filter(|resolved| !resolved.is_empty())
                    .map(str::to_owned),
                supported_effort_levels: model
                    .get("supportedEffortLevels")
                    .and_then(Value::as_array)
                    .map(|levels| {
                        levels
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_scripts::fake_claude;

    #[test]
    fn a_first_party_login_carries_its_plan_and_label() {
        let account = json!({
            "email": "user@example.com",
            "organization": "Example",
            "subscriptionType": "max",
            "tokenSource": "claude.ai",
            "apiProvider": "firstParty",
        });
        assert_eq!(
            account_of(&account),
            Some(ProviderAccount {
                account_label: Some("user@example.com".into()),
                authenticated: true,
                label: Some("max".into()),
            })
        );
        assert_eq!(
            account_label_of(&json!({"organization": "Example", "email": ""})),
            Some("Example")
        );
    }

    #[test]
    fn a_third_party_provider_is_signed_in_without_a_label() {
        let account = json!({"apiProvider": "bedrock", "email": "user@example.com"});
        assert_eq!(
            account_of(&account),
            Some(ProviderAccount {
                account_label: None,
                authenticated: true,
                label: None,
            })
        );
        assert!(is_authenticated(&json!({"apiProvider": "vertex"})));
    }

    #[test]
    fn an_account_without_login_details_is_signed_out() {
        assert_eq!(
            account_of(&json!({"apiProvider": "firstParty", "email": ""})),
            Some(ProviderAccount {
                account_label: None,
                authenticated: false,
                label: None,
            })
        );
        assert!(is_authenticated(
            &json!({"apiKeySource": "ANTHROPIC_API_KEY"})
        ));
        assert_eq!(account_of(&json!(null)), None);
        assert_eq!(account_of(&json!("max")), None);
    }

    #[test]
    fn model_rows_need_a_value_and_a_display_name() {
        let models = raw_models(&[
            json!({
                "value": "opus",
                "displayName": "Opus",
                "description": "Opus 5.5 · Best",
                "resolvedModel": "claude-opus-5-5",
                "supportedEffortLevels": ["low", 3, "high"],
                "supportsFastMode": true,
            }),
            json!({"value": "sonnet", "displayName": "Sonnet", "resolvedModel": ""}),
            json!({"value": "nameless"}),
            json!({"displayName": "No value"}),
            json!("opus"),
        ]);
        assert_eq!(
            models,
            [
                RawModel {
                    value: "opus".into(),
                    display_name: "Opus".into(),
                    description: "Opus 5.5 · Best".into(),
                    resolved_model: Some("claude-opus-5-5".into()),
                    supported_effort_levels: vec!["low".into(), "high".into()],
                },
                RawModel {
                    value: "sonnet".into(),
                    display_name: "Sonnet".into(),
                    description: String::new(),
                    resolved_model: None,
                    supported_effort_levels: Vec::new(),
                },
            ]
        );
    }

    /// Answers `initialize` with models and an account and `get_usage` with
    /// limits, records its arguments, its environment and every line it
    /// reads, and ends when its input ends.
    const ANSWERING: &str = r#"#!/bin/sh
printf '%s\n' "$@" > args.log
printf '%s\n' "$HTTPS_PROXY" > env.log
while IFS= read -r line; do
  printf '%s\n' "$line" >> stdin.log
  case "$line" in
    *'"subtype":"initialize"'*) printf '%s\n' '{"type":"control_response","response":{"subtype":"success","request_id":"codewide-1","response":{"commands":[],"models":[{"value":"default","displayName":"Default (recommended)","description":"Opus 5.5 · Best","resolvedModel":"claude-opus-5-5","supportedEffortLevels":["high"]}],"account":{"email":"user@example.com","subscriptionType":"max","tokenSource":"claude.ai"}}}}' ;;
    *get_usage*) printf '%s\n' '{"type":"control_response","response":{"subtype":"success","request_id":"codewide-2","response":{"five_hour":{"utilization":12}}}}' ;;
  esac
done
"#;

    #[tokio::test]
    async fn the_probe_reads_account_models_and_usage_from_one_short_process() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let claude = fake_claude(directory.path(), ANSWERING);
        let environment = [("HTTPS_PROXY".into(), "http://proxy.example".into())];
        let result = probe(ProbeLaunch {
            executable: &claude,
            cwd: directory.path(),
            environment: &environment,
        })
        .await
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            result.account,
            Some(ProviderAccount {
                account_label: Some("user@example.com".into()),
                authenticated: true,
                label: Some("max".into()),
            })
        );
        assert_eq!(
            result
                .models
                .iter()
                .map(|model| (model.value.as_str(), model.resolved_model.as_deref()))
                .collect::<Vec<_>>(),
            [("default", Some("claude-opus-5-5"))]
        );
        assert_eq!(
            result.usage,
            Some(json!({"five_hour": {"utilization": 12}}))
        );

        let read = |name: &str| {
            std::fs::read_to_string(directory.path().join(name))
                .unwrap_or_else(|error| panic!("{error}"))
        };
        let args = read("args.log");
        assert!(args.contains("--strict-mcp-config\n--permission-mode\ndefault\n"));
        assert!(!args.contains("--session-id") && !args.contains("--model"));
        assert_eq!(read("env.log"), "http://proxy.example\n");
        let requests: Vec<Value> = read("stdin.log")
            .lines()
            .map(|line| serde_json::from_str(line).unwrap_or_else(|error| panic!("{error}")))
            .collect();
        assert_eq!(requests[0]["request"], json!({"subtype": "initialize"}));
        assert_eq!(requests[1]["request"]["subtype"], "get_usage");
        assert_eq!(requests.len(), 2);
    }

    #[tokio::test]
    async fn a_refused_usage_read_leaves_the_usage_unknown() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let script = ANSWERING.replace(
            r#"{"subtype":"success","request_id":"codewide-2","response":{"five_hour":{"utilization":12}}}"#,
            r#"{"subtype":"error","request_id":"codewide-2","error":"unknown subtype"}"#,
        );
        let claude = fake_claude(directory.path(), &script);
        let result = probe(ProbeLaunch {
            executable: &claude,
            cwd: directory.path(),
            environment: &[],
        })
        .await
        .unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(result.usage, None);
        assert_eq!(result.models.len(), 1);
    }

    #[tokio::test]
    async fn an_answer_without_models_or_a_refused_initialize_fails_the_probe() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let no_models = ANSWERING.replace(r#""models":["#, r#""other":["#);
        let claude = fake_claude(directory.path(), &no_models);
        let result = probe(ProbeLaunch {
            executable: &claude,
            cwd: directory.path(),
            environment: &[],
        })
        .await;
        assert!(matches!(result, Err(ProbeError::NoModels)));

        let refusing = fake_claude(
            directory.path(),
            "#!/bin/sh\nIFS= read -r line\nprintf '%s\\n' '{\"type\":\"control_response\",\"response\":{\"subtype\":\"error\",\"request_id\":\"codewide-1\",\"error\":\"not logged in\"}}'\n",
        );
        let result = probe(ProbeLaunch {
            executable: &refusing,
            cwd: directory.path(),
            environment: &[],
        })
        .await;
        assert!(matches!(
            result,
            Err(ProbeError::Initialize(ProcessError::Rejected(error))) if error == "not logged in"
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn a_silent_claude_times_out_and_is_closed() {
        let directory = tempfile::tempdir().unwrap_or_else(|error| panic!("{error}"));
        let silent = fake_claude(directory.path(), "#!/bin/sh\nexec sleep 600\n");
        let result = probe(ProbeLaunch {
            executable: &silent,
            cwd: directory.path(),
            environment: &[],
        })
        .await;
        assert!(matches!(result, Err(ProbeError::Timeout)));
    }
}
