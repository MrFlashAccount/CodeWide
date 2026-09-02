//! Pure production mapping and witness helpers.

// These helpers intentionally share the parent adapter's private vocabulary;
// the split keeps each backend source file below the role size limit.
#![allow(clippy::too_many_lines, clippy::wildcard_imports)]

use super::*;

pub(super) fn require_scope(
    authorization: &AuthorizationContext,
    scope: &str,
) -> Result<(), V2Error> {
    match authorization {
        AuthorizationContext::Admin => Ok(()),
        AuthorizationContext::Session { scopes, .. }
            if scopes.iter().any(|candidate| candidate == scope) =>
        {
            Ok(())
        }
        AuthorizationContext::Session { .. } | AuthorizationContext::Device { .. } => {
            Err(V2Error::forbidden(format!("{scope} scope is required")))
        }
    }
}

pub(super) fn command_scope(command: &Command) -> &'static str {
    match command {
        Command::TurnSubmit { .. } | Command::QueueMutate { .. } => "turns.start",
        Command::TurnSteer { .. } => "turns.steer",
        Command::TurnInterrupt { .. } | Command::AccountUpdate { .. } => "processes.manage",
        Command::ProjectAdd { .. } | Command::WorkspaceCreate { .. } => "files.upload.workspace",
        Command::ThreadCreate { .. }
        | Command::ThreadFork { .. }
        | Command::ThreadUpdate { .. }
        | Command::ThreadDelete { .. }
        | Command::ThreadCompact { .. }
        | Command::ThreadRollback { .. } => "threads.write",
    }
}

pub(super) fn query_scope(query: &Query) -> &'static str {
    match query {
        Query::CapabilitiesRead
        | Query::ModelsList
        | Query::CatalogPage { .. }
        | Query::HistoryPage { .. }
        | Query::TurnItems { .. } => "threads.read",
        Query::ThreadResources { .. } | Query::ProjectsList | Query::WorkspaceInspect { .. } => {
            "files.download.workspace"
        }
        Query::QueueList { .. } | Query::OperationGet { .. } => "turns.start",
        Query::AccountsList => "processes.manage",
    }
}

pub(super) fn command_thread_id(command: &Command) -> Option<&Id> {
    match command {
        Command::ThreadFork { thread_id, .. }
        | Command::ThreadUpdate { thread_id, .. }
        | Command::ThreadDelete { thread_id }
        | Command::TurnSubmit {
            thread_id: Some(thread_id),
            ..
        }
        | Command::TurnSteer { thread_id, .. }
        | Command::TurnInterrupt { thread_id, .. }
        | Command::ThreadCompact { thread_id }
        | Command::ThreadRollback { thread_id, .. }
        | Command::QueueMutate {
            mutation: QueueMutation::Put { thread_id, .. },
        } => Some(thread_id),
        Command::ThreadCreate { .. }
        | Command::TurnSubmit {
            thread_id: None, ..
        }
        | Command::ProjectAdd { .. }
        | Command::WorkspaceCreate { .. }
        | Command::QueueMutate { .. }
        | Command::AccountUpdate { .. } => None,
    }
}

pub(super) fn queue_mutation_item_id(mutation: &QueueMutation) -> Option<&Id> {
    match mutation {
        QueueMutation::Edit { item_id, .. }
        | QueueMutation::Cancel { item_id }
        | QueueMutation::Move { item_id, .. }
        | QueueMutation::Retry { item_id } => Some(item_id),
        QueueMutation::Put { .. } => None,
    }
}

pub(super) fn command_has_attachment(command: &Command) -> bool {
    let input = match command {
        Command::TurnSubmit { input, .. }
        | Command::TurnSteer { input, .. }
        | Command::QueueMutate {
            mutation: QueueMutation::Put { input, .. } | QueueMutation::Edit { input, .. },
        } => Some(input),
        _ => None,
    };
    input.is_some_and(|input| {
        input
            .iter()
            .any(|block| matches!(block, crate::sync_v2::domain::InputBlock::Attachment { .. }))
    })
}

pub(super) fn result_thread_id(result: &CommandResult) -> Option<&Id> {
    match result {
        CommandResult::ThreadCreate { thread }
        | CommandResult::ThreadFork { thread }
        | CommandResult::ThreadUpdate { thread }
        | CommandResult::ThreadRollback { thread, .. } => Some(&thread.id),
        CommandResult::ThreadDelete { thread_id }
        | CommandResult::TurnSubmit { thread_id, .. }
        | CommandResult::TurnSteer { thread_id, .. }
        | CommandResult::TurnInterrupt { thread_id, .. }
        | CommandResult::ThreadCompact { thread_id, .. } => Some(thread_id),
        CommandResult::QueueMutate { item: Some(item) } => Some(&item.thread_id),
        CommandResult::ProjectAdd { .. }
        | CommandResult::WorkspaceCreate { .. }
        | CommandResult::QueueMutate { item: None }
        | CommandResult::AccountUpdate { .. } => None,
    }
}

pub(super) fn resource_scope(scope: ResourceScope) -> &'static str {
    match scope {
        ResourceScope::Session => "session",
        ResourceScope::LastTurn => "lastTurn",
        ResourceScope::Staged => "staged",
        ResourceScope::Unstaged => "unstaged",
        ResourceScope::Branch => "branch",
    }
}
pub(super) fn approval_policy_source(
    policy: crate::sync_v2::domain::ApprovalPolicy,
) -> &'static str {
    match policy {
        crate::sync_v2::domain::ApprovalPolicy::Never => "never",
        crate::sync_v2::domain::ApprovalPolicy::OnRequest => "on-request",
        crate::sync_v2::domain::ApprovalPolicy::Untrusted => "untrusted",
    }
}
pub(super) fn sandbox_source(sandbox: crate::sync_v2::domain::Sandbox) -> &'static str {
    match sandbox {
        crate::sync_v2::domain::Sandbox::ReadOnly => "read-only",
        crate::sync_v2::domain::Sandbox::WorkspaceWrite => "workspace-write",
        crate::sync_v2::domain::Sandbox::Unrestricted => "danger-full-access",
    }
}
pub(super) fn effort_source(
    effort: Option<crate::sync_v2::domain::Effort>,
) -> Option<&'static str> {
    effort.map(|effort| match effort {
        crate::sync_v2::domain::Effort::Low => "low",
        crate::sync_v2::domain::Effort::Medium => "medium",
        crate::sync_v2::domain::Effort::High => "high",
        crate::sync_v2::domain::Effort::Xhigh => "xhigh",
    })
}
pub(super) fn revision(kind: &str) -> String {
    format!("sync-v2-revision:{kind}:{}", Timestamp::now().as_str())
}
pub(super) fn catalog_anchor_key(anchor: &crate::sync_v2::domain::CatalogAnchor) -> String {
    format!(
        "{}:{}:{}",
        anchor
            .last_activity_at
            .as_ref()
            .map_or("null", Timestamp::as_str),
        anchor.updated_at.as_str(),
        anchor.thread_id.as_str()
    )
}

pub(super) fn thread_update_rpc(thread_id: &Id, change: ThreadUpdate) -> (&'static str, Value) {
    match change {
        ThreadUpdate::Title { title } => (
            "thread/name/set",
            json!({"threadId": thread_id.as_str(), "name": title}),
        ),
        ThreadUpdate::Archive { archived: true } => {
            ("thread/archive", json!({"threadId": thread_id.as_str()}))
        }
        ThreadUpdate::Archive { archived: false } => {
            ("thread/unarchive", json!({"threadId": thread_id.as_str()}))
        }
        ThreadUpdate::Goal { goal: Some(goal) } => (
            "thread/goal/set",
            json!({"threadId": thread_id.as_str(), "goal": goal}),
        ),
        ThreadUpdate::Goal { goal: None } => {
            ("thread/goal/clear", json!({"threadId": thread_id.as_str()}))
        }
        ThreadUpdate::Settings { settings } => (
            "thread/settings/update",
            json!({"threadId": thread_id.as_str(), "model": settings.model, "reasoningEffort": effort_source(settings.effort), "approvalPolicy": approval_policy_source(settings.approval_policy), "sandbox": sandbox_source(settings.sandbox)}),
        ),
        ThreadUpdate::Section {
            section_id,
            position,
        } => (
            "thread/section/move",
            json!({"threadId": thread_id.as_str(), "sectionId": section_id.as_ref().map(Id::as_str), "position": position.map(U64::get)}),
        ),
    }
}

pub(super) fn is_pending_method(method: &str) -> bool {
    matches!(
        method,
        "item/commandExecution/requestApproval"
            | "item/fileChange/requestApproval"
            | "item/tool/requestUserInput"
            | "item/permissions/requestApproval"
            | "mcpServer/elicitation/request"
    )
}
pub(super) fn pending_request(event: &Value, generation: u64) -> Result<PendingRequest, V2Error> {
    let method = event
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = event
        .get("params")
        .ok_or_else(|| V2Error::source_unavailable("pending request omitted params"))?;
    let id = Id::new(
        event
            .get("id")
            .map(Value::to_string)
            .unwrap_or_default()
            .trim_matches('"')
            .to_owned(),
    )
    .map_err(|_| V2Error::source_unavailable("pending request id is invalid"))?;
    let thread_id = params
        .get("threadId")
        .and_then(Value::as_str)
        .map(|value| Id::new(value.to_owned()))
        .transpose()
        .map_err(|_| V2Error::source_unavailable("pending thread id is invalid"))?;
    let turn_id = params
        .get("turnId")
        .and_then(Value::as_str)
        .map(|value| Id::new(value.to_owned()))
        .transpose()
        .map_err(|_| V2Error::source_unavailable("pending turn id is invalid"))?;
    if method == "item/tool/requestUserInput" {
        return Ok(PendingRequest::UserInput {
            id,
            generation: U64::new(generation),
            thread_id: thread_id
                .ok_or_else(|| V2Error::source_unavailable("user input request omitted thread"))?,
            turn_id: turn_id
                .ok_or_else(|| V2Error::source_unavailable("user input request omitted turn"))?,
            questions: params
                .get("questions")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|question| {
                    Some(UserInputQuestion {
                        id: Id::new(question.get("id")?.as_str()?.to_owned()).ok()?,
                        prompt: question
                            .get("prompt")
                            .or_else(|| question.get("header"))?
                            .as_str()?
                            .to_owned(),
                        choices: question
                            .get("options")
                            .and_then(Value::as_array)
                            .map(|values| {
                                values
                                    .iter()
                                    .filter_map(|value| value.as_str().map(ToOwned::to_owned))
                                    .collect()
                            })
                            .unwrap_or_default(),
                        allow_free_text: question
                            .get("isOther")
                            .or_else(|| question.get("allowFreeText"))
                            .and_then(Value::as_bool)
                            .unwrap_or(true),
                    })
                })
                .collect(),
        });
    }
    if method == "mcpServer/elicitation/request" {
        return Ok(PendingRequest::Elicitation {
            id,
            generation: U64::new(generation),
            thread_id,
            turn_id,
            title: params
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Input required")
                .to_owned(),
            fields: params
                .get("fields")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|field| {
                    Some(ElicitationField {
                        id: Id::new(field.get("id")?.as_str()?.to_owned()).ok()?,
                        label: field.get("label")?.as_str()?.to_owned(),
                        field_type: match field.get("type").and_then(Value::as_str) {
                            Some("secret") => ElicitationFieldType::Secret,
                            Some("boolean") => ElicitationFieldType::Boolean,
                            _ => ElicitationFieldType::Text,
                        },
                        required: field
                            .get("required")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                    })
                })
                .collect(),
        });
    }
    Ok(PendingRequest::Approval {
        id,
        generation: U64::new(generation),
        thread_id: thread_id
            .ok_or_else(|| V2Error::source_unavailable("approval omitted thread"))?,
        turn_id: turn_id.ok_or_else(|| V2Error::source_unavailable("approval omitted turn"))?,
        action: if method.contains("fileChange") {
            ApprovalAction::ApplyFileChange
        } else if method.contains("permissions") {
            ApprovalAction::GrantPermission
        } else {
            ApprovalAction::RunCommand
        },
        summary: params
            .get("reason")
            .or_else(|| params.get("summary"))
            .and_then(Value::as_str)
            .unwrap_or("Approval required")
            .to_owned(),
    })
}
pub(super) fn pending_id(request: &PendingRequest) -> &Id {
    match request {
        PendingRequest::Approval { id, .. }
        | PendingRequest::UserInput { id, .. }
        | PendingRequest::Elicitation { id, .. } => id,
    }
}
pub(super) fn pending_thread_id(request: &PendingRequest) -> Option<&Id> {
    match request {
        PendingRequest::Approval { thread_id, .. }
        | PendingRequest::UserInput { thread_id, .. } => Some(thread_id),
        PendingRequest::Elicitation { thread_id, .. } => thread_id.as_ref(),
    }
}
pub(super) fn pending_generation(request: &PendingRequest) -> u64 {
    match request {
        PendingRequest::Approval { generation, .. }
        | PendingRequest::UserInput { generation, .. }
        | PendingRequest::Elicitation { generation, .. } => generation.get(),
    }
}
pub(super) fn resolution_result(resolution: crate::sync_v2::protocol::RequestResolution) -> Value {
    match resolution {
        crate::sync_v2::protocol::RequestResolution::Approval { decision } => {
            json!({"decision": decision})
        }
        crate::sync_v2::protocol::RequestResolution::UserInput { answers } => {
            json!({"answers": answers})
        }
        crate::sync_v2::protocol::RequestResolution::Elicitation { values } => {
            json!({"values": values})
        }
        crate::sync_v2::protocol::RequestResolution::Cancel => json!({"cancelled": true}),
    }
}

pub(super) fn rollout_witness(
    path: &std::path::Path,
    anchor: &HistoryAnchor,
) -> Result<SourceWitness, V2Error> {
    let metadata = std::fs::metadata(path).map_err(|_| stale_cursor())?;
    let start = anchor.start_offset.map_or(0, U64::get);
    let end = anchor
        .end_offset
        .map_or_else(|| start.saturating_add(4096), U64::get)
        .min(metadata.len());
    let mut file = File::open(path).map_err(|_| stale_cursor())?;
    file.seek(SeekFrom::Start(start))
        .map_err(|_| stale_cursor())?;
    let mut bytes = vec![
        0;
        usize::try_from(end.saturating_sub(start))
            .unwrap_or(0)
            .min(64 * 1024)
    ];
    file.read_exact(&mut bytes).map_err(|_| stale_cursor())?;
    Ok(SourceWitness::Rollout {
        device: U64::new(metadata.dev()),
        inode: U64::new(metadata.ino()),
        anchor_hash: blake3::hash(&bytes).to_hex().to_string(),
        durable_end: U64::new(metadata.len()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("invalid test id: {error}"))
    }

    #[test]
    fn sensitive_families_do_not_inherit_broad_thread_scopes() {
        let read_only = AuthorizationContext::Session {
            device_id: "device".into(),
            scopes: vec!["threads.read".into()],
            expires_at: u64::MAX,
        };
        let sensitive_queries = [
            Query::ThreadResources {
                thread_id: id("thread"),
                scope: ResourceScope::Session,
            },
            Query::ProjectsList,
            Query::WorkspaceInspect {
                path: "/tmp".into(),
            },
            Query::QueueList { thread_id: None },
            Query::AccountsList,
        ];
        for query in &sensitive_queries {
            let required = query_scope(query);
            assert_ne!(required, "threads.read");
            assert!(require_scope(&read_only, required).is_err());
        }

        let sensitive_commands = [
            Command::ProjectAdd {
                path: "/tmp".into(),
                name: None,
                pinned: false,
            },
            Command::QueueMutate {
                mutation: QueueMutation::Cancel {
                    item_id: id("queue-item"),
                },
            },
            Command::AccountUpdate {
                change: AccountChange::Activate {
                    profile_id: id("profile"),
                },
            },
        ];
        for command in &sensitive_commands {
            let required = command_scope(command);
            assert_ne!(required, "threads.write");
            assert!(require_scope(&read_only, required).is_err());
        }
    }
}
