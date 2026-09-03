use super::*;

use crate::sync_v2::attachment_staging::{AttachmentStageError, StagedAttachment};

pub(super) struct ResolvedInputBlocks {
    pub(super) attachment_names: HashMap<Id, String>,
    pub(super) wire: Vec<Value>,
}

impl UpstreamSemanticSource {
    pub(super) fn authorize_attachment_access(
        &self,
        command: &Command,
        authorization: &AuthorizationContext,
        context: &AuthenticatedContextKey,
    ) -> Result<(), V2Error> {
        let (new_thread, attachment_ids) = command_attachment_ids(command);
        if attachment_ids.is_empty() {
            return Ok(());
        }
        if new_thread {
            return require_scope(authorization, "files.upload.workspace");
        }
        for attachment_id in attachment_ids {
            match self
                .services
                .attachments
                .as_ref()
                .map(|stages| stages.status(context, attachment_id))
            {
                Some(Ok(_)) => require_scope(authorization, "files.upload.workspace")?,
                None | Some(Err(AttachmentStageError::NotFound)) => {
                    require_scope(authorization, "files.download.workspace")?;
                }
                Some(Err(error)) => return Err(stage_error(&error)),
            }
        }
        Ok(())
    }

    pub(super) async fn resolve_input_blocks(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        input: &[crate::sync_v2::domain::InputBlock],
    ) -> Result<Vec<Value>, V2Error> {
        Ok(self
            .resolve_input_blocks_with_metadata(context, thread_id, input)
            .await?
            .wire)
    }

    pub(super) async fn resolve_input_blocks_with_metadata(
        &self,
        context: &AuthenticatedContextKey,
        thread_id: &Id,
        input: &[crate::sync_v2::domain::InputBlock],
    ) -> Result<ResolvedInputBlocks, V2Error> {
        if !self.has_thread_access(context, thread_id, self.generation()) {
            return Err(V2Error::forbidden(
                "thread authorization witness is unavailable",
            ));
        }
        if !input
            .iter()
            .any(|block| matches!(block, crate::sync_v2::domain::InputBlock::Attachment { .. }))
        {
            return Ok(ResolvedInputBlocks {
                attachment_names: HashMap::new(),
                wire: normalize::input_blocks(input, &HashMap::new())?,
            });
        }
        let mut resolved = HashMap::new();
        let mut attachment_names = HashMap::new();
        let mut authoritative_workspace = None;
        if let Some(stages) = &self.services.attachments {
            for block in input {
                let crate::sync_v2::domain::InputBlock::Attachment { attachment_id } = block else {
                    continue;
                };
                match stages.resolve_completed(context, thread_id, attachment_id) {
                    Ok(attachment) => {
                        if authoritative_workspace.is_none() {
                            authoritative_workspace =
                                Some(self.read_thread(thread_id).await?.workspace);
                        }
                        let Some(workspace) = authoritative_workspace.as_deref() else {
                            return Err(V2Error::source_unavailable(
                                "thread workspace is unavailable",
                            ));
                        };
                        ensure_staged_workspace(attachment.workspace.as_deref(), workspace)?;
                        attachment_names
                            .insert(attachment_id.clone(), attachment.attachment.name.clone());
                        resolved.insert(attachment_id.clone(), staged_input(&attachment)?);
                    }
                    Err(AttachmentStageError::NotFound) => {}
                    Err(error) => return Err(stage_error(&error)),
                }
            }
        }
        if resolved.len()
            == input
                .iter()
                .filter(|block| {
                    matches!(block, crate::sync_v2::domain::InputBlock::Attachment { .. })
                })
                .count()
        {
            return Ok(ResolvedInputBlocks {
                attachment_names,
                wire: normalize::input_blocks(input, &resolved)?,
            });
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
            if resolved.contains_key(&id) {
                continue;
            }
            let name = attachment
                .get("name")
                .and_then(Value::as_str)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| {
                    V2Error::source_unavailable("attachment capability omitted the file name")
                })?;
            let kind = attachment
                .get("kind")
                .and_then(Value::as_str)
                .unwrap_or("file");
            let value = if let Some(path) = attachment.get("path").and_then(Value::as_str) {
                match kind {
                    "image" => json!({"type": "localImage", "path": path}),
                    "audio" => json!({"type": "localAudio", "path": path}),
                    _ => {
                        json!({"type": "mention", "path": path, "name": name})
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
            attachment_names.insert(id.clone(), name.to_owned());
            resolved.insert(id, value);
        }
        Ok(ResolvedInputBlocks {
            attachment_names,
            wire: normalize::input_blocks(input, &resolved)?,
        })
    }

    pub(super) fn resolve_new_thread_input_blocks(
        &self,
        context: &AuthenticatedContextKey,
        workspace: &str,
        thread_id: &Id,
        input: &[crate::sync_v2::domain::InputBlock],
    ) -> Result<Vec<Value>, V2Error> {
        if workspace.is_empty()
            && input
                .iter()
                .any(|block| matches!(block, crate::sync_v2::domain::InputBlock::Attachment { .. }))
        {
            return Err(V2Error::source_unavailable(
                "thread/start omitted the resolved attachment workspace",
            ));
        }
        let mut resolved = HashMap::new();
        for block in input {
            let crate::sync_v2::domain::InputBlock::Attachment { attachment_id } = block else {
                continue;
            };
            let stages = self.services.attachments.as_ref().ok_or_else(|| {
                V2Error::invalid_request("staged attachment is unavailable for this request")
            })?;
            let attachment = stages
                .resolve_completed_for_new_thread(context, workspace, thread_id, attachment_id)
                .map_err(|error| stage_error(&error))?;
            resolved.insert(attachment_id.clone(), staged_input(&attachment)?);
        }
        normalize::input_blocks(input, &resolved)
    }
}

fn ensure_staged_workspace(
    staged_workspace: Option<&str>,
    authoritative_workspace: &str,
) -> Result<(), V2Error> {
    if authoritative_workspace.is_empty() || staged_workspace != Some(authoritative_workspace) {
        return Err(V2Error::forbidden(
            "staged attachment belongs to a different workspace",
        ));
    }
    Ok(())
}

fn command_attachment_ids(command: &Command) -> (bool, Vec<&Id>) {
    let mut ids = Vec::new();
    let (new_thread, input) = match command {
        Command::TurnSubmit {
            thread_id, input, ..
        } => (thread_id.is_none(), Some(input.as_slice())),
        Command::TurnSteer { input, .. }
        | Command::QueueMutate {
            mutation: QueueMutation::Put { input, .. },
        } => (false, Some(input.as_slice())),
        _ => (false, None),
    };
    if let Some(input) = input {
        ids.extend(input.iter().filter_map(|block| match block {
            crate::sync_v2::domain::InputBlock::Attachment { attachment_id } => Some(attachment_id),
            crate::sync_v2::domain::InputBlock::Text { .. }
            | crate::sync_v2::domain::InputBlock::Skill { .. } => None,
        }));
    }
    if let Command::QueueMutate {
        mutation: QueueMutation::Edit { editable_input, .. },
    } = command
    {
        ids.extend(editable_input.iter().filter_map(|block| match block {
            crate::sync_v2::protocol::EditableInputBlock::Attachment { attachment_id } => {
                Some(attachment_id)
            }
            crate::sync_v2::protocol::EditableInputBlock::Text { .. } => None,
        }));
    }
    (new_thread, ids)
}

fn staged_input(attachment: &StagedAttachment) -> Result<Value, V2Error> {
    let path = attachment
        .path
        .to_str()
        .ok_or_else(|| V2Error::source_unavailable("attachment staging path is unavailable"))?;
    if attachment.attachment.media_type.starts_with("image/") {
        Ok(json!({"type": "localImage", "path": path}))
    } else if attachment.attachment.media_type.starts_with("audio/") {
        Ok(json!({"type": "localAudio", "path": path}))
    } else {
        Ok(json!({
            "type": "mention",
            "name": attachment.attachment.name,
            "path": path,
        }))
    }
}

pub(super) fn stage_error(error: &AttachmentStageError) -> V2Error {
    match error {
        AttachmentStageError::Forbidden => {
            V2Error::forbidden("staged attachment is unavailable for this authenticated context")
        }
        AttachmentStageError::NotFound
        | AttachmentStageError::Invalid
        | AttachmentStageError::Expired
        | AttachmentStageError::Conflict
        | AttachmentStageError::Cancelled
        | AttachmentStageError::Timeout
        | AttachmentStageError::QuotaExceeded
        | AttachmentStageError::Integrity => {
            V2Error::invalid_request("staged attachment is unavailable or incomplete")
        }
        AttachmentStageError::Storage(_) => {
            V2Error::source_unavailable("attachment staging is unavailable")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_thread_stage_requires_the_authoritative_workspace() {
        assert!(ensure_staged_workspace(Some("/workspace"), "/workspace").is_ok());
        assert!(ensure_staged_workspace(Some("/other"), "/workspace").is_err());
        assert!(ensure_staged_workspace(None, "/workspace").is_err());
        assert!(ensure_staged_workspace(Some("/workspace"), "").is_err());
    }
}
