//! Rate-limited preview of a streaming agent answer for the thread list.
//!
//! Devices receive a thread's text deltas only while they are interested in
//! that thread (`sync/interest.rs`), so a list row of an unsubscribed thread
//! would otherwise show nothing of the answer until `item/completed`. The
//! tracker accumulates the streamed `item/agentMessage/delta` text per thread
//! and publishes a synthetic `companion/thread/preview/updated` catalog event
//! at most once per [`THREAD_PREVIEW_PUBLISH_INTERVAL`]; the tail of the
//! stream is covered by `item/completed`, which carries the full text.
//!
//! The reducer is stateful per thread, makes no model calls and reads no
//! storage. It is sampled on delta arrival (no timer): a thread that stops
//! streaming publishes nothing further. Observation happens before content
//! projection may externalize the delta text, like `LiveActivityTracker`; the
//! ingest batch owns where the returned event is appended. The patch shape it
//! travels in belongs to `thread_patch.rs`; the frequency and text bound are
//! part of `contract/v1.json` (`threadPreview`).

use std::{
    collections::HashMap,
    iter, option,
    time::{Duration, Instant},
};

use serde_json::{Map, Value, json};

/// Method of the synthetic catalog event carrying the preview.
pub const THREAD_PREVIEW_METHOD: &str = "companion/thread/preview/updated";
/// `codewideThreadPatch.operation.kind` compiled for the preview event.
pub const THREAD_PREVIEW_KIND: &str = "threadPreview";
/// Minimum spacing between two previews of the same thread.
pub const THREAD_PREVIEW_PUBLISH_INTERVAL: Duration = Duration::from_millis(1_500);
/// Longest preview text, in characters, matching the item preview bound.
pub const THREAD_PREVIEW_MAX_TEXT_CHARS: usize = 2_000;
/// Field of the event params carrying the preview text.
pub const THREAD_PREVIEW_TEXT_FIELD: &str = "previewText";
const MAX_TRACKED_THREADS: usize = 4_096;

/// The agent message currently streaming in one thread.
struct StreamingAnswer {
    item_id: String,
    turn_id: Option<String>,
    /// The first [`THREAD_PREVIEW_MAX_TEXT_CHARS`] characters of the answer.
    text: String,
    chars: usize,
    /// Characters of `text` at the last published preview. The text only
    /// grows within one item, so equal counts mean unchanged text.
    published_chars: usize,
    last_published_at: Option<Instant>,
}

impl StreamingAnswer {
    fn new(item_id: &str, turn_id: Option<&str>) -> Self {
        Self {
            item_id: item_id.to_owned(),
            turn_id: turn_id.map(str::to_owned),
            text: String::new(),
            chars: 0,
            published_chars: 0,
            last_published_at: None,
        }
    }

    fn append(&mut self, delta: &str) {
        let remaining = THREAD_PREVIEW_MAX_TEXT_CHARS.saturating_sub(self.chars);
        if remaining == 0 {
            return;
        }
        for character in delta.chars().take(remaining) {
            self.text.push(character);
            self.chars += 1;
        }
    }

    /// Whether a preview is published now: the text changed since the last
    /// preview (it stops changing at the cap) and the interval has elapsed.
    fn due(&self, now: Instant) -> bool {
        self.chars != self.published_chars
            && self.last_published_at.is_none_or(|published| {
                now.duration_since(published) >= THREAD_PREVIEW_PUBLISH_INTERVAL
            })
    }
}

/// Per-thread reducer over ordered client-wire notifications that publishes
/// bounded, rate-limited previews of the streaming agent answer.
#[derive(Default)]
pub struct ThreadPreviewTracker {
    threads: HashMap<String, StreamingAnswer>,
}

impl ThreadPreviewTracker {
    /// Observes one notification at `now` and returns the preview event it
    /// publishes, if any. Only `item/agentMessage/delta` publishes; the item's
    /// `item/completed`, `turn/completed` and `thread/deleted` clear the
    /// thread's state. Streamed text must be observed before content
    /// projection replaces it.
    pub fn observe(&mut self, payload: &Value, now: Instant) -> Option<Value> {
        let method = payload.get("method")?.as_str()?;
        let params = payload.get("params")?.as_object()?;
        let thread_id = params.get("threadId")?.as_str()?;
        match method {
            "item/agentMessage/delta" => self.observe_delta(thread_id, params, now),
            "item/completed" => {
                let completed_item = params
                    .get("item")
                    .and_then(Value::as_object)
                    .and_then(|item| item.get("id"))
                    .and_then(Value::as_str);
                if self
                    .threads
                    .get(thread_id)
                    .is_some_and(|answer| Some(answer.item_id.as_str()) == completed_item)
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

    /// Observes `payload` at `now`, then yields it followed by the preview it
    /// published, if any, so the catalog event directly follows its delta.
    /// Observation happens on the call: flat-mapping a batch lazily keeps
    /// each payload observed before its content projection may externalize
    /// the streamed text.
    pub fn followed_by_preview(
        &mut self,
        payload: Value,
        now: Instant,
    ) -> iter::Chain<iter::Once<Value>, option::IntoIter<Value>> {
        let preview = self.observe(&payload, now);
        iter::once(payload).chain(preview)
    }

    fn observe_delta(
        &mut self,
        thread_id: &str,
        params: &Map<String, Value>,
        now: Instant,
    ) -> Option<Value> {
        let item_id = params.get("itemId")?.as_str()?;
        let delta = params.get("delta")?.as_str()?;
        let turn_id = params.get("turnId").and_then(Value::as_str);
        if !self.threads.contains_key(thread_id) && self.threads.len() >= MAX_TRACKED_THREADS {
            self.threads.clear();
        }
        let answer = self
            .threads
            .entry(thread_id.to_owned())
            .or_insert_with(|| StreamingAnswer::new(item_id, turn_id));
        if answer.item_id != item_id {
            *answer = StreamingAnswer::new(item_id, turn_id);
        }
        answer.append(delta);
        if answer.text.trim().is_empty() || !answer.due(now) {
            return None;
        }
        answer.last_published_at = Some(now);
        answer.published_chars = answer.chars;
        let mut event_params = Map::from_iter([
            ("threadId".into(), Value::String(thread_id.to_owned())),
            ("itemId".into(), Value::String(answer.item_id.clone())),
            (
                THREAD_PREVIEW_TEXT_FIELD.into(),
                Value::String(answer.text.clone()),
            ),
        ]);
        if let Some(turn_id) = &answer.turn_id {
            event_params.insert("turnId".into(), Value::String(turn_id.clone()));
        }
        Some(json!({
            "method": THREAD_PREVIEW_METHOD,
            "params": Value::Object(event_params),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta(thread: &str, item: &str, text: &str) -> Value {
        json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": thread, "turnId": "turn", "itemId": item, "delta": text}
        })
    }

    fn completed(thread: &str, item: &str) -> Value {
        json!({
            "method": "item/completed",
            "params": {
                "threadId": thread,
                "turnId": "turn",
                "item": {"type": "agentMessage", "id": item, "text": "full"}
            }
        })
    }

    #[test]
    fn publishes_the_first_delta_then_at_most_once_per_interval() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();

        let first = tracker.observe(&delta("thread", "answer", "Hel"), start);
        assert_eq!(
            first,
            Some(json!({
                "method": THREAD_PREVIEW_METHOD,
                "params": {
                    "threadId": "thread", "turnId": "turn", "itemId": "answer",
                    "previewText": "Hel"
                }
            }))
        );
        assert!(
            tracker
                .observe(
                    &delta("thread", "answer", "lo"),
                    start + Duration::from_millis(500)
                )
                .is_none()
        );
        assert!(
            tracker
                .observe(
                    &delta("thread", "answer", ", "),
                    start
                        + THREAD_PREVIEW_PUBLISH_INTERVAL.saturating_sub(Duration::from_millis(1))
                )
                .is_none()
        );
        let second = tracker.observe(
            &delta("thread", "answer", "world"),
            start + THREAD_PREVIEW_PUBLISH_INTERVAL,
        );
        assert_eq!(
            second.map(|event| event["params"][THREAD_PREVIEW_TEXT_FIELD].clone()),
            Some(Value::String("Hello, world".into())),
            "the preview carries the accumulated text, not only the sampled delta"
        );
    }

    #[test]
    fn the_preview_directly_follows_the_delta_that_published_it() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        let first = tracker
            .followed_by_preview(delta("thread", "answer", "Hello"), start)
            .map(|event| event["method"].clone())
            .collect::<Vec<_>>();
        assert_eq!(
            first,
            [
                json!("item/agentMessage/delta"),
                json!(THREAD_PREVIEW_METHOD)
            ]
        );
        let throttled = tracker
            .followed_by_preview(delta("thread", "answer", "!"), start)
            .collect::<Vec<_>>();
        assert_eq!(throttled, [delta("thread", "answer", "!")]);
    }

    #[test]
    fn completion_of_the_item_or_turn_clears_the_thread() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        assert!(
            tracker
                .observe(&delta("thread", "answer", "Hello"), start)
                .is_some()
        );
        assert!(
            tracker
                .observe(&completed("thread", "answer"), start)
                .is_none()
        );
        // A fresh stream after completion publishes immediately again.
        let next = tracker.observe(&delta("thread", "next", "Again"), start);
        assert_eq!(
            next.map(|event| event["params"][THREAD_PREVIEW_TEXT_FIELD].clone()),
            Some(Value::String("Again".into()))
        );
        assert!(
            tracker
                .observe(
                    &json!({"method": "turn/completed", "params": {"threadId": "thread", "turn": {"id": "turn"}}}),
                    start
                )
                .is_none()
        );
        assert!(tracker.threads.is_empty());
    }

    #[test]
    fn another_items_completion_keeps_the_streaming_answer() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        assert!(
            tracker
                .observe(&delta("thread", "answer", "Hello"), start)
                .is_some()
        );
        assert!(
            tracker
                .observe(&completed("thread", "command"), start)
                .is_none()
        );
        assert!(tracker.threads.contains_key("thread"));
    }

    #[test]
    fn a_new_item_restarts_the_text_and_the_text_is_bounded() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        assert!(
            tracker
                .observe(&delta("thread", "first", "One"), start)
                .is_some()
        );
        let restarted = tracker.observe(
            &delta(
                "thread",
                "second",
                &"é".repeat(THREAD_PREVIEW_MAX_TEXT_CHARS + 5),
            ),
            start + THREAD_PREVIEW_PUBLISH_INTERVAL,
        );
        let text = restarted
            .and_then(|event| {
                event["params"][THREAD_PREVIEW_TEXT_FIELD]
                    .as_str()
                    .map(str::to_owned)
            })
            .unwrap_or_default();
        assert_eq!(text.chars().count(), THREAD_PREVIEW_MAX_TEXT_CHARS);
        assert!(!text.contains("One"));
    }

    #[test]
    fn a_capped_answer_publishes_its_capped_text_once() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        let chunk = "x".repeat(THREAD_PREVIEW_MAX_TEXT_CHARS / 4);
        let published = (0..12)
            .filter_map(|interval| {
                tracker.observe(
                    &delta("thread", "answer", &chunk),
                    start + THREAD_PREVIEW_PUBLISH_INTERVAL * interval,
                )
            })
            .map(|event| {
                event["params"][THREAD_PREVIEW_TEXT_FIELD]
                    .as_str()
                    .map_or(0, |text| text.chars().count())
            })
            .collect::<Vec<_>>();
        assert_eq!(
            published
                .iter()
                .filter(|&&chars| chars == THREAD_PREVIEW_MAX_TEXT_CHARS)
                .count(),
            1,
            "unchanged capped text is not republished"
        );
        assert_eq!(published.last(), Some(&THREAD_PREVIEW_MAX_TEXT_CHARS));
    }

    #[test]
    fn whitespace_only_text_and_foreign_methods_publish_nothing() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        assert!(
            tracker
                .observe(&delta("thread", "answer", "  \n"), start)
                .is_none()
        );
        assert!(
            tracker
                .observe(
                    &json!({"method": "item/plan/delta", "params": {"threadId": "thread", "itemId": "plan", "delta": "step"}}),
                    start
                )
                .is_none()
        );
        assert!(
            tracker
                .observe(
                    &json!({"method": THREAD_PREVIEW_METHOD, "params": {"threadId": "thread", "previewText": "loop"}}),
                    start
                )
                .is_none()
        );
    }

    #[test]
    fn the_thread_table_is_bounded() {
        let mut tracker = ThreadPreviewTracker::default();
        let start = Instant::now();
        for index in 0..MAX_TRACKED_THREADS {
            tracker.observe(&delta(&format!("thread-{index}"), "answer", "x"), start);
        }
        assert_eq!(tracker.threads.len(), MAX_TRACKED_THREADS);
        tracker.observe(&delta("overflow", "answer", "x"), start);
        assert_eq!(tracker.threads.len(), 1);
    }
}
