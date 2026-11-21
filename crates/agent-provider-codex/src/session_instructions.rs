//! The host's session instructions (`AgentProvider::install_session_instructions`)
//! as App Server `developerInstructions` on every `thread/start`,
//! `thread/resume` and `thread/fork` the adapter sends, the client's
//! pass-through requests included.
//!
//! App Server keeps no `developerInstructions` with a thread: a request's
//! value overrides the `developer_instructions` of the user's Codex
//! configuration for the session it starts, resumes or forks, and a later
//! cold resume without it falls back to the configuration (`Config`
//! `developer_instructions.or(cfg.developer_instructions)`; a loaded thread
//! ignores the override). So every request carries the text again, and the
//! override never drops the instructions the session would otherwise have:
//! the request's own `developerInstructions` (or a `developer_instructions`
//! key of its `config` overrides), else the effective configured value
//! (`config/read` for the request's `cwd`), followed by the host's text.
//! Instructions that already contain the host's text are left unchanged.
//!
//! A fork with `experimentalPredictionMode` is left unchanged: App Server
//! refuses configuration overrides there. When the configured value cannot
//! be read, the request is left unchanged (logged at `warn`) rather than
//! silently replacing the user's instructions.

use std::sync::OnceLock;

use agent_core::provider::SessionInstructions;
use agent_transport::UpstreamHandle;
use serde_json::{Value, json};
use tracing::warn;

/// The App Server methods that start a session of a thread.
const SESSION_METHODS: [&str; 3] = ["thread/start", "thread/resume", "thread/fork"];

/// The installed host instructions of the Codex adapter.
#[derive(Default)]
pub(crate) struct CodexSessionInstructions {
    installed: OnceLock<SessionInstructions>,
}

/// The instructions a request already names for its session.
enum Named<'a> {
    Text(&'a str),
    /// None: the session would use the configured value.
    Absent,
    /// A value App Server rejects anyway; the request is left as it is.
    Invalid,
}

impl CodexSessionInstructions {
    /// Installs the host's instructions; `false` when already installed.
    pub(crate) fn install(&self, instructions: SessionInstructions) -> bool {
        self.installed.set(instructions).is_ok()
    }

    /// Adds the host's instructions to a full JSON-RPC request of a session
    /// method; other requests are unchanged.
    pub(crate) async fn apply_to_request(&self, upstream: &UpstreamHandle, request: &mut Value) {
        let method = request
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        if let Some(params) = request.get_mut("params") {
            self.apply(upstream, &method, params).await;
        }
    }

    /// Adds the host's instructions to the `params` of `method`.
    pub(crate) async fn apply(&self, upstream: &UpstreamHandle, method: &str, params: &mut Value) {
        let Some(instructions) = self.installed.get().copied() else {
            return;
        };
        if !applies(method, params) {
            return;
        }
        let merged = match named(params) {
            Named::Invalid => return,
            Named::Text(own) => merge(Some(own), instructions),
            Named::Absent => match configured(upstream, params).await {
                Ok(configured) => merge(configured.as_deref(), instructions),
                Err(err) => {
                    warn!(method, err = %err, "session instructions not added: the Codex configuration could not be read");
                    return;
                }
            },
        };
        if let (Some(merged), Some(params)) = (merged, params.as_object_mut()) {
            params.insert("developerInstructions".into(), Value::String(merged));
        }
    }
}

/// Whether `method` with `params` starts a session the instructions reach.
fn applies(method: &str, params: &Value) -> bool {
    SESSION_METHODS.contains(&method)
        && params.is_object()
        && params.get("experimentalPredictionMode") != Some(&Value::Bool(true))
}

fn named(params: &Value) -> Named<'_> {
    let named = match params.get("developerInstructions") {
        None | Some(Value::Null) => params.pointer("/config/developer_instructions"),
        value => value,
    };
    match named {
        None | Some(Value::Null) => Named::Absent,
        Some(Value::String(text)) => Named::Text(text),
        Some(_) => Named::Invalid,
    }
}

/// The instructions to send: `own` followed by the host's; `None` when `own`
/// already contains them.
fn merge(own: Option<&str>, instructions: SessionInstructions) -> Option<String> {
    let host = instructions.text();
    match own.map(str::trim_end).filter(|own| !own.trim().is_empty()) {
        Some(own) if own.contains(host) => None,
        Some(own) => Some(format!("{own}\n\n{host}")),
        None => Some(host.to_owned()),
    }
}

/// The effective configured `developer_instructions` for the request's
/// working directory.
async fn configured(upstream: &UpstreamHandle, params: &Value) -> Result<Option<String>, String> {
    let mut read = json!({"includeLayers": false});
    if let Some(cwd) = params.get("cwd").filter(|cwd| cwd.is_string()) {
        read["cwd"] = cwd.clone();
    }
    let response = upstream
        .request(json!({
            "id": "codex-adapter:config/read",
            "method": "config/read",
            "params": read,
        }))
        .await
        .map_err(|error| error.to_string())?;
    if let Some(error) = response.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("App Server rejected config/read")
            .to_owned());
    }
    match response.pointer("/result/config/developer_instructions") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.clone())),
        Some(_) => Err("config/read returned invalid developer_instructions".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOST: SessionInstructions = SessionInstructions::new("Link every file.");

    #[test]
    fn merging_keeps_the_sessions_own_instructions_first_and_never_repeats_the_hosts() {
        assert_eq!(merge(None, HOST).as_deref(), Some("Link every file."));
        assert_eq!(merge(Some("  "), HOST).as_deref(), Some("Link every file."));
        assert_eq!(
            merge(Some("Be brief.\n"), HOST).as_deref(),
            Some("Be brief.\n\nLink every file.")
        );
        let once = merge(Some("Be brief."), HOST).unwrap_or_default();
        assert_eq!(merge(Some(&once), HOST), None);
    }

    #[test]
    fn only_session_methods_without_prediction_mode_carry_them() {
        assert!(applies("thread/start", &json!({})));
        assert!(applies("thread/resume", &json!({"threadId": "t"})));
        assert!(applies("thread/fork", &json!({"threadId": "t"})));
        assert!(!applies("turn/start", &json!({"threadId": "t"})));
        assert!(!applies(
            "thread/fork",
            &json!({"threadId": "t", "experimentalPredictionMode": true, "ephemeral": true})
        ));
    }

    #[test]
    fn the_request_names_its_instructions_directly_or_in_config_overrides() {
        assert!(matches!(
            named(&json!({"developerInstructions": "A"})),
            Named::Text("A")
        ));
        assert!(matches!(
            named(
                &json!({"developerInstructions": null, "config": {"developer_instructions": "B"}})
            ),
            Named::Text("B")
        ));
        assert!(matches!(named(&json!({"threadId": "t"})), Named::Absent));
        assert!(matches!(
            named(&json!({"developerInstructions": 3})),
            Named::Invalid
        ));
    }
}
