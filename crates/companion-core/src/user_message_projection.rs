//! Projects user messages for display, for every provider, as one step before
//! content projection: the agent receives envelopes and model-only context,
//! the client sees only what the user wrote. Canonical history is untouched.
//!
//! Each provider cleans its own formats ([`UserTextCleaner`], picked by the
//! thread's provider through [`UserTextCleaners`]); this module removes only
//! what the companion adds itself: its file envelope, which becomes
//! file/image/audio inputs, and a fork's context handoff. A message left with
//! nothing the user wrote is not shown at all: it is dropped from turns, and a
//! notification carrying only it is not delivered.

use std::collections::HashMap;
use std::sync::Arc;

use agent_core::model::ProviderId;
use agent_core::user_text::{
    CleanedText, NoUserTextFormats, UserTextCleaner, file_envelope, is_companion_context,
};
use serde_json::{Map, Value, json};

/// The enabled providers' user text cleaners; a thread of an unknown provider
/// is cleaned by the primary provider's, as its wire always was.
#[derive(Clone)]
pub(crate) struct UserTextCleaners {
    by_provider: HashMap<ProviderId, Arc<dyn UserTextCleaner>>,
    primary: ProviderId,
}

impl UserTextCleaners {
    pub(crate) fn new(
        by_provider: HashMap<ProviderId, Arc<dyn UserTextCleaner>>,
        primary: ProviderId,
    ) -> Self {
        Self {
            by_provider,
            primary,
        }
    }

    /// The cleaner of `provider`, else the primary provider's.
    pub(crate) fn for_provider(&self, provider: Option<&ProviderId>) -> &dyn UserTextCleaner {
        provider
            .and_then(|provider| self.by_provider.get(provider))
            .or_else(|| self.by_provider.get(&self.primary))
            .map_or(&NoUserTextFormats as &dyn UserTextCleaner, |cleaner| {
                cleaner.as_ref()
            })
    }
}

/// Projects one notification; `None` when it only carries a user message with
/// nothing the user wrote, which is not delivered.
pub(crate) fn project_notification(
    mut payload: Value,
    cleaner: &dyn UserTextCleaner,
) -> Option<Value> {
    let method = payload
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let Some(params) = payload.get_mut("params") else {
        return Some(payload);
    };
    match method.as_str() {
        "item/started" | "item/completed" | "item/updated" => {
            if let Some(item) = params.get_mut("item")
                && !project_item(item, cleaner)
            {
                return None;
            }
        }
        "turn/started" | "turn/completed" => {
            if let Some(turn) = params.get_mut("turn") {
                project_turn(turn, cleaner);
            }
        }
        "thread/started" => {
            if let Some(thread) = params.get_mut("thread") {
                project_thread(thread, cleaner);
            }
        }
        _ => {}
    }
    Some(payload)
}

/// Projects the user messages of an RPC result that carries turns or items.
pub(crate) fn project_rpc_result(
    method: &str,
    mut value: Value,
    cleaner: &dyn UserTextCleaner,
) -> Value {
    match method {
        "companion/thread/sync" => {
            if let Some(thread) = value.get_mut("thread") {
                project_thread(thread, cleaner);
            }
            for turn in value
                .pointer_mut("/history/turns")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                project_turn(turn, cleaner);
            }
            if let Some(turn) = value.get_mut("activeTurn") {
                project_turn(turn, cleaner);
            }
        }
        "thread/read" | "thread/resume" | "thread/start" | "thread/fork" => {
            if let Some(thread) = value.get_mut("thread") {
                project_thread(thread, cleaner);
            }
        }
        "companion/thread/history/after"
        | "companion/thread/history/before"
        | "thread/turns/list" => {
            for turn in value
                .get_mut("data")
                .and_then(Value::as_array_mut)
                .into_iter()
                .flatten()
            {
                project_turn(turn, cleaner);
            }
        }
        "thread/items/list" => {
            if let Some(entries) = value.get_mut("data").and_then(Value::as_array_mut) {
                entries.retain_mut(|entry| {
                    entry
                        .get_mut("item")
                        .is_none_or(|item| project_item(item, cleaner))
                });
            }
        }
        _ => {}
    }
    value
}

fn project_thread(thread: &mut Value, cleaner: &dyn UserTextCleaner) {
    for turn in thread
        .get_mut("turns")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
    {
        project_turn(turn, cleaner);
    }
}

fn project_turn(turn: &mut Value, cleaner: &dyn UserTextCleaner) {
    if let Some(items) = turn.get_mut("items").and_then(Value::as_array_mut) {
        items.retain_mut(|item| project_item(item, cleaner));
    }
}

/// Projects one item; `false` when it is a user message with nothing the user
/// wrote. Other items are unchanged.
fn project_item(item: &mut Value, cleaner: &dyn UserTextCleaner) -> bool {
    let Some(object) = item.as_object_mut() else {
        return true;
    };
    if object.get("type").and_then(Value::as_str) != Some("userMessage") {
        return true;
    }
    project_user_message(object, cleaner)
}

/// Projects one `userMessage`'s content; `false` when no part is left.
fn project_user_message(object: &mut Map<String, Value>, cleaner: &dyn UserTextCleaner) -> bool {
    let Some(parts) = object.get_mut("content").and_then(Value::as_array_mut) else {
        return true;
    };
    if parts.is_empty() {
        return true;
    }
    parts.retain(|part| !text_of(part).is_some_and(is_companion_context));
    project_desktop_content(parts);
    parts.retain_mut(|part| clean_text_part(part, cleaner));
    !parts.is_empty()
}

fn text_of(part: &Value) -> Option<&str> {
    (part.get("type").and_then(Value::as_str) == Some("text"))
        .then(|| part.get("text").and_then(Value::as_str))
        .flatten()
}

/// Applies the provider's cleaning to a text part; `false` drops it.
fn clean_text_part(part: &mut Value, cleaner: &dyn UserTextCleaner) -> bool {
    let Some(text) = text_of(part) else {
        return true;
    };
    match cleaner.clean(text) {
        CleanedText::Unchanged => true,
        CleanedText::ModelContext => false,
        CleanedText::Authored(authored) => {
            part["text"] = Value::String(authored);
            // Element byte ranges refer to the enveloped text; they no longer apply.
            if let Some(elements) = part.get_mut("text_elements").and_then(Value::as_array_mut) {
                elements.clear();
            }
            true
        }
    }
}

pub(crate) fn project_desktop_content(parts: &mut Vec<Value>) {
    if !parts.iter().any(|part| {
        part.get("type").and_then(Value::as_str) == Some("text")
            && part
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| {
                    text.trim_start()
                        .starts_with("# Files mentioned by the user:")
                })
    }) {
        return;
    }
    // Replacing an envelope produces multiple inputs. Move existing values
    // into the new sequence so ordinary content keeps its data and ordering.
    for mut part in std::mem::take(parts) {
        let envelope = (part.get("type").and_then(Value::as_str) == Some("text"))
            .then(|| part.get("text").and_then(Value::as_str))
            .flatten()
            .and_then(file_envelope);
        let Some(envelope) = envelope else {
            parts.push(part);
            continue;
        };
        for file in envelope.files {
            parts.push(match mentioned_attachment_kind(file.name) {
                "image" => json!({"type": "localImage", "path": file.path}),
                "audio" => json!({"type": "localAudio", "path": file.path}),
                _ => json!({"type": "mention", "name": file.name, "path": file.path}),
            });
        }
        let offset = envelope.request_offset;
        let end = offset + envelope.request.len();
        let text = Value::String(envelope.request.to_owned());
        part["text"] = text;
        if let Some(elements) = part.get_mut("text_elements").and_then(Value::as_array_mut) {
            elements.retain_mut(|element| rebase_text_element(element, offset, end));
        }
        parts.push(part);
    }
}

fn rebase_text_element(element: &mut Value, offset: usize, end: usize) -> bool {
    let Some(range) = element.get_mut("byteRange") else {
        return false;
    };
    let (Some(start), Some(finish)) = (
        range.get("start").and_then(Value::as_u64),
        range.get("end").and_then(Value::as_u64),
    ) else {
        return false;
    };
    if start < offset as u64 || finish < start || finish > end as u64 {
        return false;
    }
    range["start"] = json!(start - offset as u64);
    range["end"] = json!(finish - offset as u64);
    true
}

fn mentioned_attachment_kind(name: &str) -> &'static str {
    match mime_guess::from_path(name).first_raw() {
        Some(mime) if mime.starts_with("image/") => "image",
        Some(mime) if mime.starts_with("audio/") => "audio",
        _ => "file",
    }
}

#[cfg(test)]
mod tests {
    use agent_core::user_text::{CleanedText, NoUserTextFormats, UserTextCleaner};
    use serde_json::json;

    use super::{project_desktop_content, project_notification, project_rpc_result};

    /// A provider whose `[ctx]` texts are model-only context and whose
    /// `[wrap] …` texts wrap the authored text.
    struct Provider;

    impl UserTextCleaner for Provider {
        fn clean(&self, text: &str) -> CleanedText {
            if text.starts_with("[ctx]") {
                CleanedText::ModelContext
            } else if let Some(inner) = text.strip_prefix("[wrap] ") {
                CleanedText::Authored(inner.to_owned())
            } else {
                CleanedText::Unchanged
            }
        }
    }

    #[test]
    fn leaves_ordinary_and_incomplete_markdown_untouched() {
        for text in [
            "## My request:\n\nKeep this heading.",
            "Example:\n# Files mentioned by the user:\n## shot.png: /tmp/shot.png\n## My request:\nKeep everything.",
            "```markdown\n# Files mentioned by the user:\n## shot.png: /tmp/shot.png\n## My request:\nKeep everything.\n```",
            "# Files mentioned by the user:\n## My request:\nNot a complete envelope.",
            "# Files mentioned by the user:\n## shot.png: /tmp/shot.png",
            "# Files mentioned by the user:\n## invalid.png:\n/tmp/invalid.png\n## My request:\nNo same-line path.",
        ] {
            let mut parts = vec![json!({"type":"text", "text":text})];
            project_desktop_content(&mut parts);
            assert_eq!(parts, vec![json!({"type":"text", "text":text})]);
        }
    }

    #[test]
    fn retains_only_authored_text_spans_and_rebases_utf8_byte_offsets() {
        let prefix =
            "# Files mentioned by the user:\n## shot.png: /tmp/shot.png\n## My request:\n\n";
        let request = "Привет [ref]";
        let mut parts = vec![
            json!({"type":"text", "text":format!("{prefix}{request}\n"), "text_elements":[
                {"byteRange":{"start":0, "end":10}, "placeholder":"metadata"},
                {"byteRange":{"start":prefix.len() + "Привет ".len(), "end":prefix.len() + request.len()}, "placeholder":"[ref]"}
            ]}),
        ];
        project_desktop_content(&mut parts);
        assert_eq!(parts[1]["text"], request);
        assert_eq!(
            parts[1]["text_elements"],
            json!([
                {"byteRange":{"start":"Привет ".len(), "end":request.len()}, "placeholder":"[ref]"}
            ])
        );
    }
    #[test]
    fn drops_what_the_user_did_not_write_from_turns_and_the_stream() {
        let context = json!({"id": "ctx", "type": "userMessage", "content": [{"type": "text", "text": "[ctx] cwd=/w"}]});
        let wrapped = json!({"id": "user", "type": "userMessage", "content": [{"type": "text",
            "text": "# Files mentioned by the user:\n\n## a.md: /w/a.md\n\n## My request:\n\n[wrap] Read it"}]});
        let page = project_rpc_result(
            "thread/turns/list",
            json!({"data": [{"id": "turn", "items": [context.clone(), wrapped.clone(),
                {"id": "answer", "type": "agentMessage", "text": "Done"}]}]}),
            &Provider,
        );
        let items = &page["data"][0]["items"];
        assert_eq!(items.as_array().map(Vec::len), Some(2));
        assert_eq!(
            items[0]["content"],
            json!([{"type": "mention", "name": "a.md", "path": "/w/a.md"}, {"type": "text", "text": "Read it"}])
        );
        let notification =
            |item| json!({"method": "item/completed", "params": {"threadId": "t", "item": item}});
        assert!(project_notification(notification(context.clone()), &Provider).is_none());
        assert!(project_notification(notification(wrapped), &Provider).is_some());
        // Another provider's formats are its own: nothing is removed for it.
        assert!(project_notification(notification(context), &NoUserTextFormats).is_some());
    }

    #[test]
    fn drops_a_forks_context_handoff() {
        let forked = json!({"method": "item/completed", "params": {"item": {"id": "user", "type": "userMessage", "content": [
            {"type": "text", "text": "Context handoff (fork):\nUser: hi\n\nUser message:"},
            {"type": "text", "text": "Continue please"}
        ]}}});
        let projected = project_notification(forked, &NoUserTextFormats);
        assert_eq!(
            projected.map(|payload| payload["params"]["item"]["content"].clone()),
            Some(json!([{"type": "text", "text": "Continue please"}]))
        );
    }
}
