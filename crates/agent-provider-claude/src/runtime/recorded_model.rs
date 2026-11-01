//! The model a Claude session last answered with
//! (`host/src/history/recordedModel.ts`, `host/src/threads/recordedModels.ts`).
//!
//! It is the `message.model` of the newest main-loop assistant message in
//! the session's stored messages. Sub-agent messages (`parent_tool_use_id`
//! set) and synthetic placeholders such as `<synthetic>` are skipped. A
//! sub-agent's own transcript (`subagents/agent-<id>.jsonl`) is read with the
//! same rule: its stored rows name no `parent_tool_use_id`, so its newest
//! answer is the sub-agent's model (`native::native_subagents`), and the
//! `effort` recorded on that answer is the effort it ran with
//! ([`last_recorded_effort`]).
//! [`RecordedModels`] keeps it per session until the session file changes,
//! so every projection after the first read reports the same model.

use std::{collections::HashMap, future::Future};

use serde_json::Value;

use crate::cli::command::EFFORTS;

fn recorded_model_of(message: &Value) -> Option<&str> {
    let main_loop_answer = message.get("type").and_then(Value::as_str) == Some("assistant")
        && !message
            .get("parent_tool_use_id")
            .is_some_and(Value::is_string);
    if !main_loop_answer {
        return None;
    }
    message
        .get("message")?
        .get("model")?
        .as_str()
        .filter(|model| !model.is_empty() && !model.starts_with('<'))
}

/// The model of the newest main-loop answer among `messages` (oldest
/// first); `None` when none recorded one.
#[must_use]
pub fn last_recorded_model(messages: &[Value]) -> Option<&str> {
    messages.iter().rev().find_map(recorded_model_of)
}

/// The reasoning effort Claude sent with the newest main-loop answer among
/// `messages` (the answer [`last_recorded_model`] reads): the row's top-level
/// `effort`, one of `low` … `max`. Claude Code records the effective value of
/// each request there, whatever set it (an explicit `effort` of the spawning
/// `Agent` call, the agent definition's `effort`, else the session's effort
/// for the agent's model). `None` when that answer records none or an unknown
/// value: a model without effort support and Claude Code versions before the
/// field record nothing, and no other value is substituted.
#[must_use]
pub fn last_recorded_effort(messages: &[Value]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|message| recorded_model_of(message).is_some())?
        .get("effort")?
        .as_str()
        .filter(|effort| EFFORTS.contains(effort))
}

/// The cached read of one session.
#[derive(Clone, Debug)]
struct Recorded {
    last_modified_ms: i64,
    model: Option<String>,
}

/// The last answering model of sessions `CodeWide` never configured, read
/// from Claude's store and kept per session until the file's modification
/// time changes.
#[derive(Clone, Debug, Default)]
pub struct RecordedModels {
    recorded: HashMap<String, Recorded>,
}

impl RecordedModels {
    /// The model of the last read; `None` before one or when the session
    /// recorded none.
    #[must_use]
    pub fn cached(&self, session_id: &str) -> Option<&str> {
        self.recorded
            .get(session_id)
            .and_then(|recorded| recorded.model.as_deref())
    }

    /// The session's model: the cached one when the cached read saw the
    /// same file (`last_modified_ms`), else a new read of its messages
    /// through `read`, which is then cached.
    ///
    /// # Errors
    ///
    /// Returns the error of `read`; the cache is left unchanged.
    pub async fn load<Read, Messages, Error>(
        &mut self,
        session_id: &str,
        last_modified_ms: i64,
        read: Read,
    ) -> Result<Option<&str>, Error>
    where
        Read: FnOnce() -> Messages,
        Messages: Future<Output = Result<Vec<Value>, Error>>,
    {
        let fresh = self
            .recorded
            .get(session_id)
            .is_some_and(|known| known.last_modified_ms == last_modified_ms);
        if !fresh {
            let messages = read().await?;
            let model = last_recorded_model(&messages).map(str::to_owned);
            self.recorded.insert(
                session_id.to_owned(),
                Recorded {
                    last_modified_ms,
                    model,
                },
            );
        }
        Ok(self.cached(session_id))
    }
}

#[cfg(test)]
mod tests {
    use std::{cell::Cell, convert::Infallible};

    use serde_json::json;

    use super::*;

    fn assistant(model: &str, parent_tool_use_id: Option<&str>) -> Value {
        json!({
            "message": {"model": model, "role": "assistant"},
            "parent_tool_use_id": parent_tool_use_id,
            "type": "assistant",
        })
    }

    #[test]
    fn the_recorded_model_is_the_newest_main_loop_answers() {
        let messages = [
            assistant("claude-sonnet-4-6", None),
            assistant("claude-opus-5-5", None),
            assistant("claude-haiku-5-5", Some("toolu_1")),
            assistant("<synthetic>", None),
            json!({"message": {"content": "next"}, "type": "user"}),
        ];
        assert_eq!(last_recorded_model(&messages), Some("claude-opus-5-5"));
        assert_eq!(last_recorded_model(&[json!({"type": "user"})]), None);
        assert_eq!(last_recorded_model(&[assistant("", None)]), None);
    }

    fn answered_with(model: &str, effort: Option<&str>) -> Value {
        let mut row = assistant(model, None);
        if let Some(effort) = effort {
            row["effort"] = json!(effort);
        }
        row
    }

    #[test]
    fn the_recorded_effort_is_the_one_of_the_newest_main_loop_answer() {
        let messages = [
            answered_with("claude-opus-5-5", Some("high")),
            answered_with("claude-opus-5-5", Some("xhigh")),
            {
                let mut sub_agent = answered_with("claude-haiku-5-5", Some("low"));
                sub_agent["parent_tool_use_id"] = json!("toolu_1");
                sub_agent
            },
            answered_with("<synthetic>", None),
            json!({"message": {"content": "next"}, "type": "user"}),
        ];
        assert_eq!(last_recorded_effort(&messages), Some("xhigh"));
    }

    #[test]
    fn an_answer_without_a_known_effort_reports_none_not_an_older_one() {
        // A model without effort support records no effort on its answer;
        // the older answer's effort is not carried over.
        let unsupported = [
            answered_with("claude-opus-5-5", Some("high")),
            answered_with("claude-haiku-4-5-20251001", None),
        ];
        assert_eq!(last_recorded_effort(&unsupported), None);
        let unknown = [answered_with("claude-opus-5-5", Some("ludicrous"))];
        assert_eq!(last_recorded_effort(&unknown), None);
        assert_eq!(last_recorded_effort(&[json!({"type": "user"})]), None);
    }

    #[tokio::test]
    async fn a_session_is_read_again_only_after_its_file_changed() {
        let mut models = RecordedModels::default();
        let reads = Cell::new(0);
        let store_answers = |model: &'static str| {
            let reads = &reads;
            move || {
                reads.set(reads.get() + 1);
                let messages = vec![assistant(model, None)];
                async move { Ok::<_, Infallible>(messages) }
            }
        };
        assert_eq!(
            models.load("s1", 1, store_answers("claude-opus-5-5")).await,
            Ok(Some("claude-opus-5-5"))
        );
        // The same file: the cached model, though the store would now answer
        // differently.
        assert_eq!(
            models
                .load("s1", 1, store_answers("claude-sonnet-4-6"))
                .await,
            Ok(Some("claude-opus-5-5"))
        );
        assert_eq!(
            models
                .load("s1", 2, store_answers("claude-sonnet-4-6"))
                .await,
            Ok(Some("claude-sonnet-4-6"))
        );
        assert_eq!(models.cached("s1"), Some("claude-sonnet-4-6"));
        assert_eq!(models.cached("s2"), None);
        assert_eq!(reads.get(), 2);
    }

    #[tokio::test]
    async fn a_failed_read_keeps_the_cache() {
        let mut models = RecordedModels::default();
        let first = models
            .load("s1", 1, || async {
                Ok::<_, &str>(vec![assistant("claude-opus-5-5", None)])
            })
            .await
            .map(|model| model.map(str::to_owned));
        assert_eq!(first, Ok(Some("claude-opus-5-5".to_owned())));
        let failed = models
            .load("s1", 2, || async { Err::<Vec<Value>, _>("unreadable") })
            .await
            .map(|model| model.map(str::to_owned));
        assert_eq!(failed, Err("unreadable"));
        assert_eq!(models.cached("s1"), Some("claude-opus-5-5"));
    }
}
