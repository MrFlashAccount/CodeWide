use super::*;

impl UpstreamSemanticSource {
    pub(super) async fn resolve_input_blocks(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        input: &[crate::sync_v2::domain::InputBlock],
    ) -> Result<Vec<Value>, V2Error> {
        if !self.has_thread_access(context, thread_id, self.generation()) {
            return Err(V2Error::forbidden(
                "thread authorization witness is unavailable",
            ));
        }
        if !input
            .iter()
            .any(|block| matches!(block, crate::sync_v2::domain::InputBlock::Attachment { .. }))
        {
            return normalize::input_blocks(input, &HashMap::new());
        }
        let resources = self
            .services
            .resources
            .as_ref()
            .ok_or_else(|| V2Error::source_unavailable("resource service is unavailable"))?;
        let result = resources
            .handle(
                "companion/threadAttachments/read",
                &json!({"threadId": thread_id.as_str(), "changeScope": "session"}),
            )
            .await
            .map_err(|error| V2Error::source_unavailable(error.to_string()))?;
        let source_attachments = result
            .get("attachments")
            .and_then(Value::as_array)
            .ok_or_else(|| V2Error::source_unavailable("attachment capability omitted records"))?;
        if source_attachments.len() > 128 {
            return Err(V2Error::source_unavailable(
                "attachment capability exceeded record limit",
            ));
        }
        let mut resolved = HashMap::new();
        for attachment in source_attachments {
            let Some(raw_id) = attachment
                .get("key")
                .or_else(|| attachment.get("id"))
                .and_then(Value::as_str)
            else {
                continue;
            };
            let Ok(id) = Id::new(raw_id.to_owned()) else {
                continue;
            };
            let kind = attachment
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("file");
            let value = if let Some(path) = attachment.get("path").and_then(Value::as_str) {
                match kind {
                    "image" => json!({"type": "localImage", "path": path}),
                    "audio" => json!({"type": "localAudio", "path": path}),
                    _ => {
                        json!({"type": "mention", "path": path, "name": attachment.get("name").and_then(Value::as_str).unwrap_or("attachment")})
                    }
                }
            } else if let Some(url) = attachment.get("url").and_then(Value::as_str) {
                match kind {
                    "audio" => json!({"type": "audio", "url": url}),
                    _ => json!({"type": "image", "url": url}),
                }
            } else {
                continue;
            };
            resolved.insert(id, value);
        }
        normalize::input_blocks(input, &resolved)
    }
}
