//! What a running thread's agent is doing right now, reduced from the
//! Codex-shaped client-wire notifications that both providers share.
//!
//! The reducer is stateful per thread and publishes only changes: a reasoning
//! summary's first bold header, the item a turn just started, the plan's step
//! in progress and context compaction. The latest signal wins; a turn's start
//! or completion and any non-active thread status clear it. It makes no model
//! calls and reads no storage. The patch shape it travels in belongs to
//! `thread_patch.rs`.

use std::collections::HashMap;

use serde_json::{Map, Value, json};

/// Field of the patch operation that carries a published change.
pub const LIVE_ACTIVITY_FIELD: &str = "liveActivity";

/// Wire field a neutral plan step uses for its present-tense label (Claude's
/// `TodoWrite` `activeForm`); Codex plan steps never carry it.
pub const PLAN_STEP_ACTIVE_FORM_FIELD: &str = "codewideActiveForm";

/// Only the opening of a summary part may carry its header (upstream Codex
/// TUI reads the first bold run of the first 512 characters).
const REASONING_HEADER_WINDOW_CHARS: usize = 512;
const MAX_LABEL_CHARS: usize = 160;
const MAX_TRACKED_THREADS: usize = 4_096;
const CAPABILITY_ITEM_NAMESPACE_PREFIX: &str = "codewide.capability";

/// One short, closed description of a running thread's current work.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LiveActivity {
    /// The first bold header of the newest reasoning summary part.
    Reasoning {
        title: String,
    },
    /// The plan step in progress (its present-tense form when known).
    PlanStep {
        step: String,
    },
    /// The first line of the command being run.
    Command {
        command: String,
    },
    /// The first file of a file change and how many other files it touches.
    FileEdit {
        path: String,
        more: u32,
    },
    /// An MCP tool (`server` set) or a dynamic tool call (`server` null).
    Tool {
        server: Option<String>,
        tool: String,
    },
    WebSearch,
    Compacting,
}

/// A change to publish with the notification that caused it.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LiveActivityChange {
    Set(LiveActivity),
    Cleared,
}

impl LiveActivityChange {
    /// The wire value: the activity, or `null` for a cleared one. A patch
    /// without the field leaves the client's activity unchanged.
    #[must_use]
    pub fn to_wire(&self) -> Value {
        match self {
            Self::Set(activity) => activity.to_wire(),
            Self::Cleared => Value::Null,
        }
    }
}

impl LiveActivity {
    fn to_wire(&self) -> Value {
        match self {
            Self::Reasoning { title } => json!({"kind": "reasoning", "title": title}),
            Self::PlanStep { step } => json!({"kind": "planStep", "step": step}),
            Self::Command { command } => json!({"kind": "command", "command": command}),
            Self::FileEdit { path, more } => {
                json!({"kind": "fileEdit", "path": path, "more": more})
            }
            Self::Tool { server, tool } => json!({"kind": "tool", "server": server, "tool": tool}),
            Self::WebSearch => json!({"kind": "webSearch"}),
            Self::Compacting => json!({"kind": "compacting"}),
        }
    }
}

#[derive(Default)]
struct ReasoningPart {
    item_id: String,
    summary_index: i64,
    text: String,
    /// The part produced its header or exhausted its window.
    settled: bool,
}

#[derive(Default)]
struct ThreadState {
    published: Option<LiveActivity>,
    /// The newest transient signal: a header, an item, compaction.
    current: Option<LiveActivity>,
    /// The plan step in progress, shown when no newer signal exists.
    plan_step: Option<String>,
    reasoning: Option<ReasoningPart>,
}

impl ThreadState {
    fn effective(&self) -> Option<LiveActivity> {
        self.current.clone().or_else(|| {
            self.plan_step
                .clone()
                .map(|step| LiveActivity::PlanStep { step })
        })
    }

    fn is_idle(&self) -> bool {
        self.published.is_none()
            && self.current.is_none()
            && self.plan_step.is_none()
            && self.reasoning.is_none()
    }
}

/// Per-thread reducer over ordered client-wire notifications.
#[derive(Default)]
pub struct LiveActivityTracker {
    threads: HashMap<String, ThreadState>,
}

impl LiveActivityTracker {
    /// Observes one notification and returns the change it publishes, if any.
    /// Streamed text must be observed before content projection replaces it.
    pub fn observe(&mut self, payload: &Value) -> Option<LiveActivityChange> {
        let method = payload.get("method")?.as_str()?;
        let params = payload.get("params")?.as_object()?;
        let thread_id = params.get("threadId")?.as_str()?;
        if !self.threads.contains_key(thread_id) {
            if !starts_tracking(method, params) {
                return None;
            }
            if self.threads.len() >= MAX_TRACKED_THREADS {
                self.threads.clear();
            }
        }
        let state = self.threads.entry(thread_id.to_owned()).or_default();
        reduce(state, method, params);
        let next = state.effective();
        let change = (next != state.published).then(|| match &next {
            Some(activity) => LiveActivityChange::Set(activity.clone()),
            None => LiveActivityChange::Cleared,
        });
        state.published = next;
        if state.is_idle() {
            self.threads.remove(thread_id);
        }
        change
    }
}

/// Only a signal that can produce an activity creates per-thread state;
/// clearing notifications for an untracked thread change nothing.
fn starts_tracking(method: &str, params: &Map<String, Value>) -> bool {
    match method {
        "item/started" => params
            .get("item")
            .and_then(Value::as_object)
            .and_then(item_activity)
            .is_some(),
        "item/reasoning/summaryPartAdded" | "item/reasoning/summaryTextDelta" => true,
        "turn/plan/updated" => plan_step(params).is_some(),
        _ => false,
    }
}

fn reduce(state: &mut ThreadState, method: &str, params: &Map<String, Value>) {
    match method {
        "turn/started" | "turn/completed" => {
            *state = ThreadState {
                published: state.published.take(),
                ..ThreadState::default()
            }
        }
        "thread/status/changed" => {
            let active = params
                .get("status")
                .and_then(|status| status.get("type"))
                .and_then(Value::as_str)
                == Some("active");
            if !active {
                *state = ThreadState {
                    published: state.published.take(),
                    ..ThreadState::default()
                };
            }
        }
        "item/started" => {
            let item = params.get("item").and_then(Value::as_object);
            // A background task report arriving mid-turn is not the agent's own
            // work: the current activity stays.
            if item
                .and_then(|item| item.get("type"))
                .and_then(Value::as_str)
                == Some("codewideTaskNotification")
            {
                return;
            }
            state.reasoning = None;
            state.current = item.and_then(item_activity);
        }
        "item/reasoning/summaryPartAdded" => {
            if let Some((item_id, summary_index)) = reasoning_part_id(params) {
                state.reasoning = Some(ReasoningPart {
                    item_id: item_id.to_owned(),
                    summary_index,
                    ..ReasoningPart::default()
                });
            }
        }
        "item/reasoning/summaryTextDelta" => observe_reasoning_delta(state, params),
        "turn/plan/updated" => {
            let step = plan_step(params);
            if step != state.plan_step {
                // A newly started step is the newest signal.
                state.current = None;
                state.plan_step = step;
            }
        }
        _ => {}
    }
}

fn reasoning_part_id(params: &Map<String, Value>) -> Option<(&str, i64)> {
    Some((
        params.get("itemId")?.as_str()?,
        params.get("summaryIndex")?.as_i64()?,
    ))
}

fn observe_reasoning_delta(state: &mut ThreadState, params: &Map<String, Value>) {
    let Some((item_id, summary_index)) = reasoning_part_id(params) else {
        return;
    };
    let Some(delta) = params.get("delta").and_then(Value::as_str) else {
        return;
    };
    // Providers without `summaryPartAdded` (Claude) open a part implicitly.
    let part = match &mut state.reasoning {
        Some(part) if part.item_id == item_id && part.summary_index == summary_index => part,
        reasoning => reasoning.insert(ReasoningPart {
            item_id: item_id.to_owned(),
            summary_index,
            ..ReasoningPart::default()
        }),
    };
    if part.settled {
        return;
    }
    let room = REASONING_HEADER_WINDOW_CHARS.saturating_sub(part.text.chars().count());
    part.text.extend(delta.chars().take(room));
    if let Some(title) = first_bold(&part.text) {
        part.settled = true;
        state.current = Some(LiveActivity::Reasoning { title });
    } else if part.text.chars().count() >= REASONING_HEADER_WINDOW_CHARS {
        part.settled = true;
    }
}

/// The trimmed text of the first closed `**bold**` run, if it is not empty.
fn first_bold(text: &str) -> Option<String> {
    let start = text.find("**")? + 2;
    let end = start + text[start..].find("**")?;
    bounded_label(&text[start..end])
}

fn item_activity(item: &Map<String, Value>) -> Option<LiveActivity> {
    match item.get("type")?.as_str()? {
        "commandExecution" => {
            // Codex parses the shell wrapper away in `commandActions`.
            let parsed = item
                .get("commandActions")
                .and_then(Value::as_array)
                .and_then(|actions| actions.first())
                .and_then(|action| action.get("command"))
                .and_then(Value::as_str);
            let command = parsed.and_then(first_line).or_else(|| {
                item.get("command")
                    .and_then(Value::as_str)
                    .and_then(first_line)
            })?;
            Some(LiveActivity::Command { command })
        }
        "fileChange" => {
            let changes = item.get("changes")?.as_array()?;
            let path = changes
                .first()?
                .get("path")?
                .as_str()
                .and_then(bounded_label)?;
            let more = u32::try_from(changes.len() - 1).unwrap_or(u32::MAX);
            Some(LiveActivity::FileEdit { path, more })
        }
        "mcpToolCall" => Some(LiveActivity::Tool {
            server: item
                .get("server")
                .and_then(Value::as_str)
                .and_then(bounded_label),
            tool: item
                .get("tool")
                .and_then(Value::as_str)
                .and_then(bounded_label)?,
        }),
        "dynamicToolCall" => {
            let namespace = item.get("namespace").and_then(Value::as_str);
            if namespace
                .is_some_and(|namespace| namespace.starts_with(CAPABILITY_ITEM_NAMESPACE_PREFIX))
            {
                return None;
            }
            Some(LiveActivity::Tool {
                server: None,
                tool: item
                    .get("tool")
                    .and_then(Value::as_str)
                    .and_then(bounded_label)?,
            })
        }
        "webSearch" => Some(LiveActivity::WebSearch),
        "contextCompaction" => Some(LiveActivity::Compacting),
        _ => None,
    }
}

fn plan_step(params: &Map<String, Value>) -> Option<String> {
    let step = params
        .get("plan")?
        .as_array()?
        .iter()
        .filter_map(Value::as_object)
        .find(|step| step.get("status").and_then(Value::as_str) == Some("inProgress"))?;
    step.get(PLAN_STEP_ACTIVE_FORM_FIELD)
        .and_then(Value::as_str)
        .and_then(bounded_label)
        .or_else(|| {
            step.get("step")
                .and_then(Value::as_str)
                .and_then(bounded_label)
        })
}

fn first_line(text: &str) -> Option<String> {
    text.lines().find_map(bounded_label)
}

fn bounded_label(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(text.chars().take(MAX_LABEL_CHARS).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(method: &str, params: &Value) -> Value {
        json!({"method": method, "params": params})
    }

    fn delta(text: &str, index: i64) -> Value {
        event(
            "item/reasoning/summaryTextDelta",
            &json!({"threadId": "t", "turnId": "u", "itemId": "r", "summaryIndex": index, "delta": text}),
        )
    }

    fn started(item: &Value) -> Value {
        event(
            "item/started",
            &json!({"threadId": "t", "turnId": "u", "item": item}),
        )
    }

    fn observe(tracker: &mut LiveActivityTracker, payload: &Value) -> Option<Value> {
        tracker.observe(payload).map(|change| change.to_wire())
    }

    #[test]
    fn reasoning_header_is_published_once_it_closes_across_deltas() {
        let mut tracker = LiveActivityTracker::default();
        assert_eq!(observe(&mut tracker, &delta("**Inspect", 0)), None);
        assert_eq!(
            observe(&mut tracker, &delta("ing tests** and then", 0)),
            Some(json!({"kind": "reasoning", "title": "Inspecting tests"}))
        );
        assert_eq!(
            observe(&mut tracker, &delta(" more **text** later", 0)),
            None,
            "a part publishes only its first header"
        );
        assert_eq!(
            observe(&mut tracker, &delta("**Next step**", 1)),
            Some(json!({"kind": "reasoning", "title": "Next step"})),
            "a new summary part publishes its own header"
        );
    }

    #[test]
    fn a_header_past_the_opening_window_is_ignored() {
        let mut tracker = LiveActivityTracker::default();
        let filler = "x".repeat(REASONING_HEADER_WINDOW_CHARS);
        assert_eq!(observe(&mut tracker, &delta(&filler, 0)), None);
        assert_eq!(observe(&mut tracker, &delta("**Late**", 0)), None);
    }

    #[test]
    fn a_started_item_replaces_the_reasoning_header() {
        let mut tracker = LiveActivityTracker::default();
        observe(&mut tracker, &delta("**Plan**", 0));
        assert_eq!(
            observe(
                &mut tracker,
                &started(&json!({
                    "type": "commandExecution",
                    "id": "c",
                    "command": "/bin/bash -lc 'cargo test'",
                    "commandActions": [{"type": "unknown", "command": "cargo test\n--nocapture"}]
                }))
            ),
            Some(json!({"kind": "command", "command": "cargo test"}))
        );
        assert_eq!(
            observe(
                &mut tracker,
                &started(&json!({
                    "type": "fileChange",
                    "id": "f",
                    "changes": [{"path": "src/vcs.rs"}, {"path": "a"}, {"path": "b"}]
                }))
            ),
            Some(json!({"kind": "fileEdit", "path": "src/vcs.rs", "more": 2}))
        );
        assert_eq!(
            observe(
                &mut tracker,
                &started(
                    &json!({"type": "mcpToolCall", "id": "m", "server": "github", "tool": "search"})
                )
            ),
            Some(json!({"kind": "tool", "server": "github", "tool": "search"}))
        );
        assert_eq!(
            observe(
                &mut tracker,
                &started(&json!({"type": "webSearch", "id": "w"}))
            ),
            Some(json!({"kind": "webSearch"}))
        );
        assert_eq!(
            observe(
                &mut tracker,
                &started(&json!({"type": "contextCompaction", "id": "k"}))
            ),
            Some(json!({"kind": "compacting"}))
        );
        assert_eq!(
            observe(
                &mut tracker,
                &started(&json!({"type": "agentMessage", "id": "a"}))
            ),
            Some(Value::Null),
            "an item without a label is newer than the previous signal"
        );
    }

    #[test]
    fn a_task_report_keeps_the_current_activity() {
        let mut tracker = LiveActivityTracker::default();
        let running = observe(
            &mut tracker,
            &started(&json!({"type": "commandExecution", "id": "c", "command": "cargo test"})),
        );
        assert!(running.is_some());
        let report = observe(
            &mut tracker,
            &started(&json!({"type": "codewideTaskNotification", "id": "r"})),
        );
        assert_eq!(report, None);
    }

    #[test]
    fn plan_step_prefers_the_active_form_and_backs_newer_signals() {
        let mut tracker = LiveActivityTracker::default();
        let plan = event(
            "turn/plan/updated",
            &json!({"threadId": "t", "turnId": "u", "plan": [
                {"step": "Reproduce", "status": "completed"},
                {"step": "Fix the parser", "status": "inProgress", "codewideActiveForm": "Fixing the parser"},
            ]}),
        );
        assert_eq!(
            observe(&mut tracker, &plan),
            Some(json!({"kind": "planStep", "step": "Fixing the parser"}))
        );
        assert_eq!(
            observe(&mut tracker, &plan),
            None,
            "an unchanged step publishes nothing"
        );
        observe(
            &mut tracker,
            &started(&json!({"type": "webSearch", "id": "w"})),
        );
        assert_eq!(
            observe(
                &mut tracker,
                &started(&json!({"type": "reasoning", "id": "r"}))
            ),
            Some(json!({"kind": "planStep", "step": "Fixing the parser"})),
            "the step in progress shows again when no newer signal remains"
        );
    }

    #[test]
    fn codex_plan_steps_use_their_text() {
        let mut tracker = LiveActivityTracker::default();
        assert_eq!(
            observe(
                &mut tracker,
                &event(
                    "turn/plan/updated",
                    &json!({"threadId": "t", "turnId": "u", "plan": [{"step": "Verify", "status": "inProgress"}]}),
                )
            ),
            Some(json!({"kind": "planStep", "step": "Verify"}))
        );
    }

    #[test]
    fn completion_and_inactive_status_clear_the_activity() {
        let mut tracker = LiveActivityTracker::default();
        observe(
            &mut tracker,
            &started(&json!({"type": "webSearch", "id": "w"})),
        );
        assert_eq!(
            observe(
                &mut tracker,
                &event(
                    "thread/status/changed",
                    &json!({"threadId": "t", "status": {"type": "active", "activeFlags": ["waitingOnApproval"]}}),
                )
            ),
            None,
            "an active status keeps the activity"
        );
        assert_eq!(
            observe(
                &mut tracker,
                &event(
                    "turn/completed",
                    &json!({"threadId": "t", "turn": {"id": "u", "status": "interrupted"}}),
                )
            ),
            Some(Value::Null)
        );
        assert!(
            tracker.threads.is_empty(),
            "a cleared thread holds no state"
        );

        observe(
            &mut tracker,
            &started(&json!({"type": "webSearch", "id": "w"})),
        );
        assert_eq!(
            observe(
                &mut tracker,
                &event(
                    "thread/status/changed",
                    &json!({"threadId": "t", "status": {"type": "idle"}}),
                )
            ),
            Some(Value::Null)
        );
    }

    #[test]
    fn notifications_without_activity_publish_nothing() {
        let mut tracker = LiveActivityTracker::default();
        for payload in [
            event(
                "turn/completed",
                &json!({"threadId": "t", "turn": {"id": "u"}}),
            ),
            started(&json!({"type": "agentMessage", "id": "a"})),
            event(
                "item/agentMessage/delta",
                &json!({"threadId": "t", "turnId": "u", "itemId": "a", "delta": "**x**"}),
            ),
            started(&json!({
                "type": "dynamicToolCall",
                "id": "d",
                "namespace": "codewide.capability.goal",
                "tool": "set"
            })),
        ] {
            assert_eq!(observe(&mut tracker, &payload), None);
        }
        assert!(tracker.threads.is_empty());
    }

    #[test]
    fn wire_value_distinguishes_a_cleared_activity() {
        assert_eq!(LiveActivityChange::Cleared.to_wire(), Value::Null);
        assert_eq!(
            LiveActivityChange::Set(LiveActivity::Tool {
                server: None,
                tool: "Read".into()
            })
            .to_wire(),
            json!({"kind": "tool", "server": null, "tool": "Read"})
        );
    }
}
