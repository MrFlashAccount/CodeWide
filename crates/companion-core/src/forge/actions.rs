//! Action catalogs and the action-run journal.
//!
//! Catalog values a client does not know are parsed as the contract states,
//! never guessed: an unknown kind becomes `extension`; a descriptor with an
//! unknown `confirm`, an invalid input type, or `disabled` without a reason
//! is dropped (logged by its opaque `actionId`); an unknown placement falls
//! back to `overflow` and an unknown anchor to `null`.
//!
//! Kind floors only raise a level and are enforced here as well as on
//! Android: a run whose `confirmation` is below the effective level is
//! rejected with `-32089` before anything is journaled or written.
//!
//! The journal (`forge_action_runs`) records a run as `started` before the
//! plugin call and its terminal outcome after. A repeated idempotency key
//! returns the stored outcome and never calls the plugin again; a run left
//! `started` by an earlier companion process is `unknown`.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tracing::warn;

use super::{
    errors::{Confirmation, ForgeError},
    ids::{HeadRevision, PullRequestKey, new_uuid},
    wire::{ActionCatalogWire, now_rfc3339},
};
use crate::store::{IndexStore, forge_tables::FORGE_ACTION_RUNS, kv::KvOp};

/// The companion's own scenario actions.
pub const SCENARIO_ACTION_PREFIX: &str = "codewide.scenario.";

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionKind {
    Verdict,
    Merge,
    AutoMerge,
    UpdateBranch,
    Close,
    FixCi,
    Rebase,
    AddressComments,
    ReviewPr,
    Extension,
}

impl ActionKind {
    fn parse(value: &str) -> Self {
        match value {
            "verdict" => Self::Verdict,
            "merge" => Self::Merge,
            "autoMerge" => Self::AutoMerge,
            "updateBranch" => Self::UpdateBranch,
            "close" => Self::Close,
            "fixCi" => Self::FixCi,
            "rebase" => Self::Rebase,
            "addressComments" => Self::AddressComments,
            "reviewPr" => Self::ReviewPr,
            _ => Self::Extension,
        }
    }

    /// The level a kind requires at least.
    #[must_use]
    pub fn floor(self) -> Confirmation {
        match self {
            Self::Merge | Self::Close => Confirmation::Destructive,
            Self::AutoMerge | Self::UpdateBranch => Confirmation::Confirm,
            _ => Confirmation::None,
        }
    }

    /// The companion's own agent scenarios. Only the companion declares
    /// them, from the pull request's own state (a `fixCi` only on a failed
    /// check); a plugin descriptor of one of these kinds is dropped.
    #[must_use]
    pub fn is_scenario(self) -> bool {
        matches!(
            self,
            Self::FixCi | Self::Rebase | Self::AddressComments | Self::ReviewPr
        )
    }

    /// Kinds that only run through their own trigger (Submit review, or a
    /// scenario start), never through `action/run`.
    #[must_use]
    pub fn runs_elsewhere(self) -> bool {
        matches!(
            self,
            Self::Verdict | Self::FixCi | Self::Rebase | Self::AddressComments | Self::ReviewPr
        )
    }
}

/// A validated descriptor.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionDescriptor {
    pub action_id: String,
    pub kind: ActionKind,
    pub group: String,
    pub label: String,
    pub availability: Value,
    pub toggle: Option<Value>,
    pub input: Option<Value>,
    pub confirm: Confirmation,
    pub placement: String,
    pub order: i64,
    pub is_default: bool,
    pub anchor: Option<Value>,
}

impl ActionDescriptor {
    #[must_use]
    pub fn effective_confirmation(&self) -> Confirmation {
        self.confirm.max(self.kind.floor())
    }

    #[must_use]
    pub fn enabled(&self) -> bool {
        self.availability.get("state").and_then(Value::as_str) == Some("enabled")
    }

    #[must_use]
    pub fn toggle_on(&self) -> Option<bool> {
        self.toggle.as_ref()?.get("on")?.as_bool()
    }
}

/// Parses one raw descriptor; `None` drops it.
#[must_use]
pub fn parse_descriptor(raw: &Value) -> Option<ActionDescriptor> {
    let text = |field: &str| raw.get(field).and_then(Value::as_str).map(str::to_owned);
    let action_id = text("actionId").filter(|id| !id.is_empty() && id.len() <= 128)?;
    let drop = |why: &str| {
        warn!(action_id = %action_id, reason = why, "forge action descriptor dropped");
    };
    let availability = match raw.get("availability") {
        Some(value) if value.get("state").and_then(Value::as_str) == Some("enabled") => {
            json!({"state": "enabled"})
        }
        Some(value) if value.get("state").and_then(Value::as_str) == Some("disabled") => {
            let Some(reason) = value
                .get("reason")
                .and_then(Value::as_str)
                .filter(|reason| !reason.trim().is_empty())
            else {
                drop("disabled without reason");
                return None;
            };
            json!({"state": "disabled", "reason": reason})
        }
        _ => {
            drop("invalid availability");
            return None;
        }
    };
    let confirm = match raw.get("confirm").and_then(Value::as_str) {
        Some("none") => Confirmation::None,
        Some("confirm") => Confirmation::Confirm,
        Some("destructive") => Confirmation::Destructive,
        _ => {
            drop("unknown confirm level");
            return None;
        }
    };
    let input = match raw.get("input") {
        None | Some(Value::Null) => None,
        Some(input) => {
            if let Some(valid) = parse_input(input) {
                Some(valid)
            } else {
                drop("invalid input");
                return None;
            }
        }
    };
    let toggle = raw
        .get("toggle")
        .and_then(|toggle| toggle.get("on")?.as_bool())
        .map(|on| json!({ "on": on }));
    let placement = match raw.get("placement").and_then(Value::as_str) {
        Some(placement @ ("primary" | "secondary" | "overflow")) => placement.to_owned(),
        _ => "overflow".to_owned(),
    };
    Some(ActionDescriptor {
        kind: ActionKind::parse(raw.get("kind").and_then(Value::as_str).unwrap_or("")),
        group: text("group").unwrap_or_default(),
        label: text("label").filter(|label| !label.is_empty())?,
        availability,
        toggle,
        input,
        confirm,
        placement,
        order: raw.get("order").and_then(Value::as_i64).unwrap_or(0),
        is_default: raw.get("isDefault").and_then(Value::as_bool) == Some(true),
        anchor: raw.get("anchor").and_then(parse_anchor),
        action_id,
    })
}

fn parse_input(input: &Value) -> Option<Value> {
    let label = input.get("label")?.as_str()?;
    match input.get("type")?.as_str()? {
        "text" => Some(json!({
            "type": "text", "label": label,
            "placeholder": input.get("placeholder").and_then(Value::as_str),
        })),
        "boolean" => Some(json!({"type": "boolean", "label": label})),
        "enum" => {
            let options = input
                .get("options")?
                .as_array()?
                .iter()
                .map(|option| {
                    Some(json!({
                        "value": option.get("value")?.as_str()?,
                        "label": option.get("label")?.as_str()?,
                    }))
                })
                .collect::<Option<Vec<_>>>()?;
            (!options.is_empty())
                .then(|| json!({"type": "enum", "label": label, "options": options}))
        }
        _ => None,
    }
}

fn parse_anchor(anchor: &Value) -> Option<Value> {
    let field = |name: &str| anchor.get(name).and_then(Value::as_str);
    match field("kind")? {
        "header" => Some(json!({"kind": "header"})),
        "conflict" => Some(json!({"kind": "conflict"})),
        "checks" => Some(json!({"kind": "checks", "checkId": field("checkId")?})),
        "reviewThread" => {
            Some(json!({"kind": "reviewThread", "reviewThreadId": field("reviewThreadId")?}))
        }
        "file" => Some(json!({"kind": "file", "path": field("path")?})),
        _ => None,
    }
}

/// Parses a raw plugin catalog. Within each group the first `isDefault`
/// in order wins; with none, the first by order is the default.
#[must_use]
pub fn parse_catalog(raw: &[Value]) -> Vec<ActionDescriptor> {
    let mut actions: Vec<ActionDescriptor> = raw
        .iter()
        .filter_map(parse_descriptor)
        .filter(|action| {
            !action.action_id.starts_with(SCENARIO_ACTION_PREFIX) && !action.kind.is_scenario()
        })
        .collect();
    actions.sort_by_key(|action| action.order);
    let mut seen_ids = std::collections::HashSet::new();
    actions.retain(|action| seen_ids.insert(action.action_id.clone()));
    let mut groups: Vec<String> = Vec::new();
    for action in &actions {
        if !groups.contains(&action.group) {
            groups.push(action.group.clone());
        }
    }
    for group in groups {
        let indices: Vec<usize> = actions
            .iter()
            .enumerate()
            .filter(|(_, action)| action.group == group)
            .map(|(index, _)| index)
            .collect();
        let winner = indices
            .iter()
            .copied()
            .find(|index| actions[*index].is_default)
            .or_else(|| indices.first().copied());
        for index in indices {
            actions[index].is_default = Some(index) == winner;
        }
    }
    actions
}

#[must_use]
pub fn catalog_wire(
    head_revision: HeadRevision,
    actions: &[ActionDescriptor],
) -> ActionCatalogWire {
    ActionCatalogWire {
        head_revision,
        actions: actions
            .iter()
            .filter_map(|action| serde_json::to_value(action).ok())
            .collect(),
    }
}

/// Checks a run's input against the descriptor's input type.
///
/// # Errors
///
/// Returns invalid params for a mismatching input.
pub fn validate_input(action: &ActionDescriptor, input: &Value) -> Result<(), ForgeError> {
    let Some(spec) = &action.input else {
        return if input.is_null() {
            Ok(())
        } else {
            Err(ForgeError::invalid("this action takes no input"))
        };
    };
    // Turning a toggle off needs no input.
    if input.is_null() && action.toggle_on() == Some(true) {
        return Ok(());
    }
    let valid = match spec.get("type").and_then(Value::as_str) {
        Some("text") => input.as_str().is_some_and(|text| text.len() <= 4_096),
        Some("boolean") => input.is_boolean(),
        Some("enum") => input.as_str().is_some_and(|value| {
            spec.get("options")
                .and_then(Value::as_array)
                .is_some_and(|options| options.iter().any(|option| option["value"] == value))
        }),
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(ForgeError::invalid("the input does not match the action"))
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunState {
    Started,
    Succeeded,
    RejectedStale,
    Rejected,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RunKind {
    Action,
    Submit,
    Scenario,
    /// `companion/pullRequest/comment/create`; `actionId` is `comment`.
    Comment,
    /// `companion/pullRequest/reviewThread/reply`; `actionId` is the
    /// review thread id.
    ReviewThreadReply,
    /// `companion/pullRequest/reviewThread/resolve`; `actionId` is the
    /// requested state and the thread id, `resolved:<id>` or
    /// `unresolved:<id>`.
    ReviewThreadResolve,
}

/// One journal record. `result` is the stored client result of a success,
/// `error` the stored JSON-RPC error of a rejection; neither carries a
/// token.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRecord {
    pub version: u32,
    pub run_id: String,
    pub kind: RunKind,
    pub pull_request: PullRequestKey,
    pub action_id: String,
    pub state: RunState,
    /// The companion process that started the run.
    pub instance: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub result: Option<Value>,
    pub error: Option<Value>,
}

/// What a journal lookup decided.
pub enum Begin {
    /// Journaled as started; the caller runs the plugin call.
    Run(RunRecord),
    /// The key is known; the caller returns this outcome.
    Replay(Result<Value, Value>),
}

#[derive(Clone)]
pub struct Journal {
    store: Arc<IndexStore>,
    instance: String,
}

impl Journal {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self {
            store,
            instance: new_uuid(),
        }
    }

    /// Journals `started` for a new key, or decides the replay of a known
    /// one. A key reused for another pull request or action is invalid.
    ///
    /// # Errors
    ///
    /// Returns a storage failure or invalid params for a reused key.
    pub fn begin(
        &self,
        idempotency_key: &str,
        kind: RunKind,
        pull_request: &PullRequestKey,
        action_id: &str,
    ) -> Result<Begin, ForgeError> {
        let record = RunRecord {
            version: 1,
            run_id: new_uuid(),
            kind,
            pull_request: pull_request.clone(),
            action_id: action_id.to_owned(),
            state: RunState::Started,
            instance: self.instance.clone(),
            started_at: now_rfc3339(),
            finished_at: None,
            result: None,
            error: None,
        };
        let encoded =
            serde_json::to_vec(&record).map_err(|error| ForgeError::internal(error.to_string()))?;
        let Some(existing) =
            self.store
                .kv_insert_absent(FORGE_ACTION_RUNS, idempotency_key, &encoded)?
        else {
            return Ok(Begin::Run(record));
        };
        let existing = matching(&existing, kind, pull_request, action_id)?;
        Ok(Begin::Replay(self.outcome_of(idempotency_key, existing)?))
    }

    /// The stored outcome of a known key without journaling anything new;
    /// `None` for an unknown key.
    ///
    /// # Errors
    ///
    /// Returns a storage failure or invalid params for a reused key.
    pub fn peek(
        &self,
        idempotency_key: &str,
        kind: RunKind,
        pull_request: &PullRequestKey,
        action_id: &str,
    ) -> Result<Option<Result<Value, Value>>, ForgeError> {
        let Some(existing) = self.store.kv_get(FORGE_ACTION_RUNS, idempotency_key)? else {
            return Ok(None);
        };
        let existing = matching(&existing, kind, pull_request, action_id)?;
        Ok(Some(self.outcome_of(idempotency_key, existing)?))
    }

    /// A terminal record replays its outcome; a `started` record of an
    /// earlier process becomes `unknown`, and one still running in this
    /// process is reported as unknown to the duplicate.
    fn outcome_of(
        &self,
        idempotency_key: &str,
        existing: RunRecord,
    ) -> Result<Result<Value, Value>, ForgeError> {
        Ok(match existing.state {
            RunState::Succeeded => Ok(existing.result.unwrap_or(Value::Null)),
            RunState::RejectedStale | RunState::Rejected => {
                Err(existing.error.unwrap_or(Value::Null))
            }
            RunState::Started if existing.instance == self.instance => {
                Err(outcome_unknown(&existing.run_id))
            }
            RunState::Started => {
                self.finish(idempotency_key, &existing, RunState::Unknown, None, None)?;
                Err(outcome_unknown(&existing.run_id))
            }
            RunState::Unknown => Err(outcome_unknown(&existing.run_id)),
        })
    }

    /// Journals a terminal outcome.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn finish(
        &self,
        idempotency_key: &str,
        record: &RunRecord,
        state: RunState,
        result: Option<Value>,
        error: Option<Value>,
    ) -> Result<(), ForgeError> {
        let finished = RunRecord {
            state,
            finished_at: Some(now_rfc3339()),
            result,
            error,
            ..record.clone()
        };
        let value = serde_json::to_vec(&finished)
            .map_err(|error| ForgeError::internal(error.to_string()))?;
        self.store.kv_apply(vec![KvOp::Put {
            table: FORGE_ACTION_RUNS,
            key: idempotency_key.to_owned(),
            value,
        }])?;
        Ok(())
    }

    /// Whether `record` was started by this companion process.
    #[must_use]
    pub fn is_current(&self, record: &RunRecord) -> bool {
        record.instance == self.instance
    }

    /// Every journal record (tests and diagnostics).
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn records(&self) -> Result<Vec<RunRecord>, ForgeError> {
        Ok(self
            .store
            .kv_scan(FORGE_ACTION_RUNS, "")?
            .into_iter()
            .filter_map(|(_, value)| serde_json::from_slice(&value).ok())
            .collect())
    }
}

fn matching(
    bytes: &[u8],
    kind: RunKind,
    pull_request: &PullRequestKey,
    action_id: &str,
) -> Result<RunRecord, ForgeError> {
    let existing: RunRecord = serde_json::from_slice(bytes)
        .map_err(|_| ForgeError::internal("the action journal is unreadable"))?;
    if existing.kind != kind
        || existing.pull_request != *pull_request
        || existing.action_id != action_id
    {
        return Err(ForgeError::invalid(
            "the idempotency key was used for another request",
        ));
    }
    Ok(existing)
}

fn outcome_unknown(run_id: &str) -> Value {
    ForgeError::OutcomeUnknown {
        run_id: run_id.to_owned(),
    }
    .to_rpc_error()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    fn raw(id: &str, kind: &str, confirm: &str) -> Value {
        json!({"actionId": id, "kind": kind, "group": "g", "label": id,
               "availability": {"state": "enabled"}, "toggle": null, "input": null,
               "confirm": confirm, "placement": "primary", "order": 1, "isDefault": false,
               "anchor": {"kind": "header"}})
    }

    #[test]
    fn floors_raise_levels_and_unknown_values_follow_the_contract() {
        let merge = parse_descriptor(&raw("merge", "merge", "none")).expect("merge");
        assert_eq!(merge.effective_confirmation(), Confirmation::Destructive);
        let auto = parse_descriptor(&raw("auto", "autoMerge", "none")).expect("auto");
        assert_eq!(auto.effective_confirmation(), Confirmation::Confirm);
        let unknown = parse_descriptor(&raw("x", "teleport", "confirm")).expect("x");
        assert_eq!(unknown.kind, ActionKind::Extension);
        assert!(parse_descriptor(&raw("y", "merge", "maybe")).is_none());
        let mut disabled = raw("z", "close", "destructive");
        disabled["availability"] = json!({"state": "disabled"});
        assert!(parse_descriptor(&disabled).is_none());
        let mut odd = raw("w", "extension", "none");
        odd["placement"] = json!("floating");
        odd["anchor"] = json!({"kind": "moon"});
        let odd = parse_descriptor(&odd).expect("kept");
        assert_eq!(odd.placement, "overflow");
        assert_eq!(odd.anchor, None);
        let mut bad_input = raw("v", "extension", "none");
        bad_input["input"] = json!({"type": "color", "label": "c"});
        assert!(parse_descriptor(&bad_input).is_none());
    }

    #[test]
    fn one_default_per_group_and_scenario_ids_are_reserved() {
        let mut a = raw("a", "extension", "none");
        a["order"] = json!(2);
        let mut b = raw("b", "extension", "none");
        b["order"] = json!(1);
        let mut c = raw("c", "extension", "none");
        c["isDefault"] = json!(true);
        c["order"] = json!(3);
        let spoof = raw("codewide.scenario.fixCi", "fixCi", "none");
        // A plugin's own fixCi, anchored to a check the companion never
        // judged failed, is dropped like a spoofed scenario id.
        let mut plugin_fix = raw("plugin.fix", "fixCi", "none");
        plugin_fix["anchor"] = json!({"kind": "checks", "checkId": "passing"});
        let actions = parse_catalog(&[a, b, c, spoof, plugin_fix]);
        assert_eq!(actions.len(), 3);
        let defaults: Vec<&str> = actions
            .iter()
            .filter(|action| action.is_default)
            .map(|action| action.action_id.as_str())
            .collect();
        assert_eq!(defaults, vec!["c"]);
    }

    #[test]
    fn a_repeated_key_replays_and_a_restart_yields_outcome_unknown() {
        let directory = tempfile::tempdir().expect("dir");
        let store = Arc::new(IndexStore::open(directory.path().join("state.redb")).expect("store"));
        let pr = PullRequestKey::issue(
            "github",
            &forge_protocol::ForgePrRef {
                host: "github.com".into(),
                repository: "o/r".into(),
                number: "1".into(),
            },
        );
        let journal = Journal::new(store.clone());
        let Begin::Run(record) = journal
            .begin("key-1", RunKind::Action, &pr, "merge")
            .expect("begin")
        else {
            panic!("first begin runs");
        };
        journal
            .finish(
                "key-1",
                &record,
                RunState::Succeeded,
                Some(json!({"ok": 1})),
                None,
            )
            .expect("finish");
        assert!(matches!(
            journal.begin("key-1", RunKind::Action, &pr, "merge").expect("replay"),
            Begin::Replay(Ok(value)) if value == json!({"ok": 1})
        ));
        assert!(
            journal
                .begin("key-1", RunKind::Action, &pr, "close")
                .is_err()
        );
        let Begin::Run(_) = journal
            .begin("key-2", RunKind::Action, &pr, "merge")
            .expect("begin")
        else {
            panic!("new key runs");
        };
        // A new companion process sees key-2 still started.
        let restarted = Journal::new(store);
        match restarted
            .begin("key-2", RunKind::Action, &pr, "merge")
            .expect("replay")
        {
            Begin::Replay(Err(error)) => assert_eq!(error["data"]["kind"], "outcomeUnknown"),
            _ => panic!("a restart in started is outcomeUnknown"),
        }
        assert_eq!(
            restarted
                .records()
                .expect("records")
                .iter()
                .filter(|record| record.state == RunState::Unknown)
                .count(),
            1
        );
    }
}
