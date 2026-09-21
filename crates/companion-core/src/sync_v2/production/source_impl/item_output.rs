//! Authoritative bounded output pages for command and tool timeline items.

use super::*;

const ITEM_SCAN_PAGE_SIZE: u16 = 100;

struct ItemOutputSnapshot {
    format: ItemOutputFormat,
    content: String,
    hash: String,
}

impl UpstreamSemanticSource {
    #[allow(clippy::too_many_arguments)]
    pub(super) async fn item_output(
        &self,
        context: &AuthenticatedContextKey,
        generation: u64,
        thread_id: Id,
        turn_id: Id,
        item_id: Id,
        cursor: Option<String>,
        limit_bytes: u32,
    ) -> Result<QueryResult, V2Error> {
        let witness = self.resolve_item_output_cursor(
            context,
            &thread_id,
            &turn_id,
            &item_id,
            generation,
            cursor.as_deref(),
        )?;
        let output = self
            .fetch_item_output(&thread_id, &turn_id, &item_id)
            .await?;
        ensure_generation(self, generation)?;
        if witness
            .as_ref()
            .is_some_and(|cursor| cursor.output_hash != output.hash)
        {
            return Err(stale_cursor());
        }
        let offset = witness.as_ref().map_or(0, |cursor| cursor.offset);
        let (output_text, next_offset) =
            bounded_utf8_page(&output.content, offset, limit_bytes as usize)?;
        let next = (next_offset < output.content.len()).then(|| {
            self.wrap_item_output_cursor(
                context,
                ItemOutputCursorWitness {
                    offset: next_offset,
                    output_hash: output.hash,
                    thread_id: thread_id.clone(),
                    turn_id: turn_id.clone(),
                    item_id: item_id.clone(),
                    generation,
                },
            )
        });
        Ok(QueryResult::ItemOutput {
            thread_id,
            turn_id,
            item_id,
            format: output.format,
            content: output_text.to_owned(),
            total_bytes: U64::new(output.content.len() as u64),
            next,
        })
    }

    async fn fetch_item_output(
        &self,
        thread_id: &Id,
        turn_id: &Id,
        item_id: &Id,
    ) -> Result<ItemOutputSnapshot, V2Error> {
        let mut cursor = None;
        let mut seen_cursors = HashSet::new();
        loop {
            let result = self
                .rpc(
                    "thread/items/list",
                    json!({
                        "threadId": thread_id.as_str(),
                        "turnId": turn_id.as_str(),
                        "cursor": cursor,
                        "limit": ITEM_SCAN_PAGE_SIZE,
                        "sortDirection": "desc"
                    }),
                )
                .await?;
            let entries = result
                .get("data")
                .and_then(Value::as_array)
                .ok_or_else(|| V2Error::source_unavailable("thread/items/list omitted data"))?;
            if entries.len() > ITEM_SCAN_PAGE_SIZE as usize {
                return Err(V2Error::source_unavailable(
                    "turn item source exceeded record limit",
                ));
            }
            for entry in entries {
                if entry.get("turnId").and_then(Value::as_str) != Some(turn_id.as_str()) {
                    return Err(V2Error::source_unavailable(
                        "turn item source returned a different turn",
                    ));
                }
                let item = entry
                    .get("item")
                    .ok_or_else(|| V2Error::source_unavailable("turn item source omitted item"))?;
                if item.get("id").and_then(Value::as_str) == Some(item_id.as_str()) {
                    return extract_item_output(item);
                }
            }
            let Some(next) = result.get("nextCursor").and_then(Value::as_str) else {
                return Err(item_output_not_found());
            };
            if !seen_cursors.insert(next.to_owned()) {
                return Err(V2Error::source_unavailable(
                    "turn item source repeated its continuation cursor",
                ));
            }
            cursor = Some(next.to_owned());
        }
    }
}

fn extract_item_output(item: &Value) -> Result<ItemOutputSnapshot, V2Error> {
    let (format, output_text) = match item.get("type").and_then(Value::as_str) {
        Some("commandExecution") => (
            ItemOutputFormat::Terminal,
            item.get("aggregatedOutput")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        ),
        Some("mcpToolCall" | "tool") => (
            ItemOutputFormat::Json,
            encoded_optional_value(item.get("result")),
        ),
        Some("dynamicToolCall") => (
            ItemOutputFormat::Json,
            encoded_optional_value(item.get("contentItems")),
        ),
        _ => return Err(item_output_not_found()),
    };
    let hash = blake3::hash(output_text.as_bytes()).to_hex().to_string();
    Ok(ItemOutputSnapshot {
        format,
        content: output_text,
        hash,
    })
}

fn encoded_optional_value(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) => String::new(),
        Some(value) => value.to_string(),
    }
}

fn bounded_utf8_page(
    content: &str,
    offset: usize,
    limit_bytes: usize,
) -> Result<(&str, usize), V2Error> {
    if offset > content.len() || !content.is_char_boundary(offset) {
        return Err(stale_cursor());
    }
    let mut end = content.len().min(offset.saturating_add(limit_bytes));
    while end > offset && !content.is_char_boundary(end) {
        end -= 1;
    }
    Ok((&content[offset..end], end))
}

fn item_output_not_found() -> V2Error {
    V2Error {
        code: ErrorCode::NotFound,
        recovery: Recovery::Requery,
        message: "requested item output was not found".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_output_preserves_content_beyond_inline_preview_limit() -> Result<(), String> {
        let output = "x".repeat(16_385);
        let item = json!({
            "type": "commandExecution",
            "id": "item-1",
            "aggregatedOutput": output,
        });

        let extracted = extract_item_output(&item).map_err(|error| format!("{error:?}"))?;

        assert_eq!(extracted.format, ItemOutputFormat::Terminal);
        assert_eq!(extracted.content.len(), 16_385);
        Ok(())
    }

    #[test]
    fn output_pages_are_byte_bounded_and_keep_utf8_whole() -> Result<(), String> {
        let content = "a💚b";

        let (first, next) =
            bounded_utf8_page(content, 0, 4).map_err(|error| format!("{error:?}"))?;
        let (second, end) =
            bounded_utf8_page(content, next, 4).map_err(|error| format!("{error:?}"))?;

        assert_eq!(first, "a");
        assert_eq!(second, "💚");
        assert_eq!(end, 5);
        Ok(())
    }

    #[test]
    fn tool_output_uses_the_authoritative_unbounded_result() -> Result<(), String> {
        let payload = "result".repeat(4_000);
        let item = json!({
            "type": "mcpToolCall",
            "id": "item-1",
            "result": {"payload": payload},
        });

        let extracted = extract_item_output(&item).map_err(|error| format!("{error:?}"))?;

        assert_eq!(extracted.format, ItemOutputFormat::Json);
        assert!(extracted.content.len() > 16_384);
        assert!(extracted.content.contains("resultresult"));
        Ok(())
    }
}
