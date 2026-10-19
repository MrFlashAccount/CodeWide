//! Accumulated text of the agent answer streaming in each thread.
//!
//! Devices receive a thread's text deltas only while they are interested in
//! that thread, so the list row of any other thread shows the answer through
//! this accumulator: the streamed `item/agentMessage/delta` text is collected
//! per thread up to [`MAX_PREVIEW_CHARS`] and becomes the row preview. The
//! subscriber coalesces the frames, so the accumulator has no rate limit of
//! its own. The item's `item/completed` (which carries the full text),
//! `turn/completed` and `thread/deleted` end the stream.
//!
//! The text must be observed before content projection may externalize the
//! delta, so the ingest batch calls [`PreviewTracker::observe`] on the raw
//! payload. Pure state: no storage, no clock.

use std::collections::HashMap;

use serde_json::Value;

use super::{MAX_PREVIEW_CHARS, MAX_TRACKED_ROWS};

/// The agent message currently streaming in one thread.
struct StreamingAnswer {
    item_id: String,
    /// The first [`MAX_PREVIEW_CHARS`] characters of the answer.
    text: String,
    chars: usize,
}

impl StreamingAnswer {
    fn new(item_id: &str) -> Self {
        Self {
            item_id: item_id.to_owned(),
            text: String::new(),
            chars: 0,
        }
    }

    /// Appends the delta within the bound; returns whether the text grew.
    fn append(&mut self, delta: &str) -> bool {
        let before = self.chars;
        for character in delta
            .chars()
            .take(MAX_PREVIEW_CHARS.saturating_sub(self.chars))
        {
            self.text.push(character);
            self.chars += 1;
        }
        self.chars != before
    }
}

/// Per-thread reducer over ordered raw notifications.
#[derive(Default)]
pub(super) struct PreviewTracker {
    threads: HashMap<String, StreamingAnswer>,
}

impl PreviewTracker {
    /// Observes one raw notification and returns the thread's new preview
    /// text when an agent-message delta changed it to non-blank text.
    pub(super) fn observe(&mut self, payload: &Value) -> Option<String> {
        let method = payload.get("method")?.as_str()?;
        let params = payload.get("params")?.as_object()?;
        let thread_id = params.get("threadId")?.as_str()?;
        match method {
            "item/agentMessage/delta" => {
                let item_id = params.get("itemId")?.as_str()?;
                let delta = params.get("delta")?.as_str()?;
                if !self.threads.contains_key(thread_id) && self.threads.len() >= MAX_TRACKED_ROWS {
                    self.threads.clear();
                }
                let answer = self
                    .threads
                    .entry(thread_id.to_owned())
                    .or_insert_with(|| StreamingAnswer::new(item_id));
                if answer.item_id != item_id {
                    *answer = StreamingAnswer::new(item_id);
                }
                let grew = answer.append(delta);
                (grew && !answer.text.trim().is_empty()).then(|| answer.text.clone())
            }
            "item/completed" => {
                let completed = params
                    .get("item")
                    .and_then(|item| item.get("id"))
                    .and_then(Value::as_str);
                if self
                    .threads
                    .get(thread_id)
                    .is_some_and(|answer| Some(answer.item_id.as_str()) == completed)
                {
                    self.threads.remove(thread_id);
                }
                None
            }
            "turn/completed" | "thread/deleted" => {
                self.threads.remove(thread_id);
                None
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn delta(thread: &str, item: &str, text: &str) -> Value {
        json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": thread, "turnId": "turn", "itemId": item, "delta": text}
        })
    }

    #[test]
    fn every_growing_delta_yields_the_accumulated_text() {
        let mut tracker = PreviewTracker::default();
        assert_eq!(
            tracker
                .observe(&delta("thread", "answer", "Hel"))
                .as_deref(),
            Some("Hel")
        );
        assert_eq!(
            tracker.observe(&delta("thread", "answer", "lo")).as_deref(),
            Some("Hello")
        );
        assert_eq!(tracker.observe(&delta("thread", "answer", "")), None);
    }

    #[test]
    fn completion_of_the_item_or_turn_ends_the_stream() {
        let mut tracker = PreviewTracker::default();
        tracker.observe(&delta("thread", "answer", "Hello"));
        tracker.observe(&json!({"method": "item/completed", "params": {
            "threadId": "thread", "item": {"type": "commandExecution", "id": "other"}
        }}));
        assert!(
            tracker.threads.contains_key("thread"),
            "another item's completion keeps the stream"
        );
        tracker.observe(&json!({"method": "item/completed", "params": {
            "threadId": "thread", "item": {"type": "agentMessage", "id": "answer"}
        }}));
        assert!(tracker.threads.is_empty());
        tracker.observe(&delta("thread", "next", "Again"));
        tracker.observe(&json!({"method": "turn/completed", "params": {"threadId": "thread"}}));
        assert!(tracker.threads.is_empty());
    }

    #[test]
    fn a_new_item_restarts_the_text_and_the_text_is_bounded() {
        let mut tracker = PreviewTracker::default();
        tracker.observe(&delta("thread", "first", "One"));
        let restarted = tracker
            .observe(&delta(
                "thread",
                "second",
                &"é".repeat(MAX_PREVIEW_CHARS + 5),
            ))
            .unwrap_or_default();
        assert_eq!(restarted.chars().count(), MAX_PREVIEW_CHARS);
        assert!(!restarted.contains("One"));
        assert_eq!(
            tracker.observe(&delta("thread", "second", "more")),
            None,
            "a capped answer does not change"
        );
    }

    #[test]
    fn blank_text_and_foreign_methods_yield_nothing() {
        let mut tracker = PreviewTracker::default();
        assert_eq!(tracker.observe(&delta("thread", "answer", "  \n")), None);
        assert_eq!(
            tracker.observe(&json!({"method": "item/plan/delta", "params": {
                "threadId": "thread", "itemId": "plan", "delta": "step"
            }})),
            None
        );
    }

    #[test]
    fn the_thread_table_is_bounded() {
        let mut tracker = PreviewTracker::default();
        for index in 0..MAX_TRACKED_ROWS {
            tracker.observe(&delta(&format!("thread-{index}"), "answer", "x"));
        }
        assert_eq!(tracker.threads.len(), MAX_TRACKED_ROWS);
        tracker.observe(&delta("overflow", "answer", "x"));
        assert_eq!(tracker.threads.len(), 1);
    }
}
