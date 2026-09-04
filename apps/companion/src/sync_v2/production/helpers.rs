//! Pure production mapping and witness helpers.

// These helpers intentionally share the parent adapter's private vocabulary;
// the split keeps each backend source file below the role size limit.
#![allow(clippy::too_many_lines, clippy::wildcard_imports)]

use super::permissions::{permission_profile, permission_profile_source};
use super::*;

pub(super) fn command_thread_id(command: &Command) -> Option<&Id> {
    match command {
        Command::ThreadFork { thread_id, .. }
        | Command::ThreadUpdate { thread_id, .. }
        | Command::ThreadDelete { thread_id }
        | Command::ThreadMarkRead { thread_id, .. }
        | Command::TurnSubmit {
            thread_id: Some(thread_id),
            ..
        }
        | Command::TurnSteer { thread_id, .. }
        | Command::ReviewStart { thread_id, .. }
        | Command::TurnInterrupt { thread_id, .. }
        | Command::ThreadCompact { thread_id }
        | Command::ThreadRollback { thread_id, .. }
        | Command::ProcessTerminate { thread_id, .. }
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
        | Command::AccountUpdate { .. }
        | Command::AccountLoginStart
        | Command::AccountLoginCancel { .. }
        | Command::RequestResolve { .. } => None,
    }
}

pub(super) fn queue_mutation_item_id(mutation: &QueueMutation) -> Option<&Id> {
    match mutation {
        QueueMutation::Edit { item_id, .. }
        | QueueMutation::Cancel { item_id, .. }
        | QueueMutation::Move { item_id, .. }
        | QueueMutation::Retry { item_id, .. }
        | QueueMutation::Steer { item_id, .. } => Some(item_id),
        QueueMutation::Put { .. } => None,
    }
}

pub(super) fn result_thread_id(result: &CommandResult) -> Option<&Id> {
    match result {
        CommandResult::ThreadCreate { thread }
        | CommandResult::ThreadFork { thread }
        | CommandResult::ThreadUpdate { thread }
        | CommandResult::ThreadRollback { thread, .. } => Some(&thread.id),
        CommandResult::ThreadDelete { thread_id }
        | CommandResult::ThreadMarkRead { thread_id, .. }
        | CommandResult::TurnSubmit { thread_id, .. }
        | CommandResult::TurnSteer { thread_id, .. }
        | CommandResult::ReviewStart { thread_id, .. }
        | CommandResult::TurnInterrupt { thread_id, .. }
        | CommandResult::ThreadCompact { thread_id, .. }
        | CommandResult::QueueMutate {
            outcome: crate::sync_v2::protocol::QueueMutationOutcome::Steered { thread_id, .. },
        } => Some(thread_id),
        CommandResult::QueueMutate {
            outcome: crate::sync_v2::protocol::QueueMutationOutcome::Item { item },
        } => Some(&item.thread_id),
        CommandResult::ProjectAdd { .. }
        | CommandResult::WorkspaceCreate { .. }
        | CommandResult::QueueMutate {
            outcome: crate::sync_v2::protocol::QueueMutationOutcome::Cancelled { .. },
        }
        | CommandResult::AccountUpdate { .. }
        | CommandResult::AccountLoginStart { .. }
        | CommandResult::AccountLoginCancel { .. }
        | CommandResult::ProcessTerminate { .. }
        | CommandResult::RequestResolve { .. } => None,
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
pub(super) fn parse_resource_scope(value: &str) -> Result<ResourceScope, V2Error> {
    match value {
        "session" => Ok(ResourceScope::Session),
        "lastTurn" => Ok(ResourceScope::LastTurn),
        "staged" => Ok(ResourceScope::Staged),
        "unstaged" => Ok(ResourceScope::Unstaged),
        "branch" => Ok(ResourceScope::Branch),
        _ => Err(V2Error::source_unavailable(
            "resource source returned an unknown scope",
        )),
    }
}

pub(super) fn review_capabilities(supports_detached: bool) -> ReviewCapabilities {
    let mut deliveries = vec![ReviewDelivery::Inline];
    if supports_detached {
        deliveries.push(ReviewDelivery::Detached);
    }
    ReviewCapabilities {
        target_kinds: vec![
            ReviewTargetKind::UncommittedChanges,
            ReviewTargetKind::BaseBranch,
            ReviewTargetKind::Commit,
            ReviewTargetKind::Custom,
        ],
        deliveries,
    }
}

pub(super) fn parse_skill(value: &Value) -> Result<Skill, V2Error> {
    Ok(Skill {
        name: required_string_field(value, "name", "skill")?,
        description: required_string_field(value, "description", "skill")?,
        path: required_string_field(value, "path", "skill")?,
        enabled: required_bool_field(value, "enabled", "skill")?,
    })
}

pub(super) fn review_target_source(target: ReviewTarget) -> Value {
    match target {
        ReviewTarget::UncommittedChanges => json!({"type": "uncommittedChanges"}),
        ReviewTarget::BaseBranch { branch } => json!({"type": "baseBranch", "branch": branch}),
        ReviewTarget::Commit { sha, title } => {
            json!({"type": "commit", "sha": sha, "title": title})
        }
        ReviewTarget::Custom { instructions } => {
            json!({"type": "custom", "instructions": instructions})
        }
    }
}
pub(super) fn approval_policy_source(policy: crate::sync_v2::domain::ApprovalPolicy) -> Value {
    match policy {
        crate::sync_v2::domain::ApprovalPolicy::Never => json!("never"),
        crate::sync_v2::domain::ApprovalPolicy::OnRequest => json!("on-request"),
        crate::sync_v2::domain::ApprovalPolicy::Untrusted => json!("untrusted"),
        crate::sync_v2::domain::ApprovalPolicy::Granular(config) => json!({
            "granular": {
                "sandbox_approval": config.sandbox_approval,
                "rules": config.rules,
                "skill_approval": config.skill_approval,
                "request_permissions": config.request_permissions,
                "mcp_elicitations": config.mcp_elicitations,
            }
        }),
    }
}
pub(super) fn sandbox_source(sandbox: crate::sync_v2::domain::Sandbox) -> Option<&'static str> {
    match sandbox {
        crate::sync_v2::domain::Sandbox::ReadOnly => Some("read-only"),
        crate::sync_v2::domain::Sandbox::WorkspaceWrite => Some("workspace-write"),
        crate::sync_v2::domain::Sandbox::Unrestricted => Some("danger-full-access"),
        crate::sync_v2::domain::Sandbox::ExternalSandbox { .. } => None,
    }
}

pub(super) fn sandbox_policy_source(sandbox: crate::sync_v2::domain::Sandbox) -> Value {
    match sandbox {
        crate::sync_v2::domain::Sandbox::ReadOnly => {
            json!({"type": "readOnly", "networkAccess": false})
        }
        crate::sync_v2::domain::Sandbox::WorkspaceWrite => json!({
            "type": "workspaceWrite",
            "writableRoots": [],
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false,
        }),
        crate::sync_v2::domain::Sandbox::Unrestricted => {
            json!({"type": "dangerFullAccess"})
        }
        crate::sync_v2::domain::Sandbox::ExternalSandbox { network_access } => json!({
            "type": "externalSandbox",
            "networkAccess": match network_access {
                NetworkAccess::Restricted => "restricted",
                NetworkAccess::Enabled => "enabled",
            },
        }),
    }
}
pub(super) fn effort_source(
    effort: Option<crate::sync_v2::domain::Effort>,
) -> Option<&'static str> {
    effort.map(|effort| match effort {
        crate::sync_v2::domain::Effort::None => "none",
        crate::sync_v2::domain::Effort::Minimal => "minimal",
        crate::sync_v2::domain::Effort::Low => "low",
        crate::sync_v2::domain::Effort::Medium => "medium",
        crate::sync_v2::domain::Effort::High => "high",
        crate::sync_v2::domain::Effort::Xhigh => "xhigh",
        crate::sync_v2::domain::Effort::Max => "max",
        crate::sync_v2::domain::Effort::Ultra => "ultra",
    })
}
pub(super) fn personality_source(
    personality: Option<crate::sync_v2::domain::Personality>,
) -> Option<&'static str> {
    personality.map(|personality| match personality {
        crate::sync_v2::domain::Personality::None => "none",
        crate::sync_v2::domain::Personality::Friendly => "friendly",
        crate::sync_v2::domain::Personality::Pragmatic => "pragmatic",
    })
}

pub(super) fn thread_start_params(
    workspace: Option<&str>,
    settings: &crate::sync_v2::domain::ThreadSettings,
) -> Value {
    json!({
        "cwd": workspace,
        "model": settings.model,
        "approvalPolicy": approval_policy_source(settings.approval_policy),
        "sandbox": sandbox_source(settings.sandbox),
        "personality": personality_source(settings.personality),
    })
}

pub(super) fn thread_fork_params(thread_id: &Id, through_turn_id: Option<&Id>) -> Value {
    json!({
        "threadId": thread_id.as_str(),
        "lastTurnId": through_turn_id.map(Id::as_str),
        "beforeTurnId": null,
        "excludeTurns": true,
    })
}

pub(super) fn turn_start_params(
    thread_id: &Id,
    input: Vec<Value>,
    settings: Option<&crate::sync_v2::domain::ThreadSettings>,
) -> Value {
    let mut params = serde_json::Map::from_iter([
        ("threadId".to_owned(), json!(thread_id.as_str())),
        ("input".to_owned(), Value::Array(input)),
    ]);
    if let Some(settings) = settings {
        params.insert("model".to_owned(), json!(settings.model));
        params.insert("effort".to_owned(), json!(effort_source(settings.effort)));
        params.insert(
            "approvalPolicy".to_owned(),
            approval_policy_source(settings.approval_policy),
        );
        params.insert(
            "sandboxPolicy".to_owned(),
            sandbox_policy_source(settings.sandbox),
        );
        params.insert(
            "personality".to_owned(),
            json!(personality_source(settings.personality)),
        );
    }
    Value::Object(params)
}

pub(super) fn turn_steer_params(thread_id: &Id, turn_id: &Id, input: Vec<Value>) -> Value {
    Value::Object(serde_json::Map::from_iter([
        ("threadId".to_owned(), json!(thread_id.as_str())),
        ("expectedTurnId".to_owned(), json!(turn_id.as_str())),
        ("input".to_owned(), Value::Array(input)),
    ]))
}

pub(super) fn thread_settings_update_params(
    thread_id: &Id,
    settings: &crate::sync_v2::domain::ThreadSettings,
) -> Value {
    json!({
        "threadId": thread_id.as_str(),
        "model": settings.model,
        "effort": effort_source(settings.effort),
        "approvalPolicy": approval_policy_source(settings.approval_policy),
        "sandboxPolicy": sandbox_policy_source(settings.sandbox),
        "personality": personality_source(settings.personality),
    })
}

pub(super) fn thread_section_move_params(
    thread_id: &Id,
    section_id: Option<&Id>,
    before_thread_id: Option<&Id>,
) -> Value {
    json!({
        "threadId": thread_id.as_str(),
        "sectionId": section_id.map(Id::as_str),
        "beforeThreadId": before_thread_id.map(Id::as_str),
    })
}

pub(super) fn thread_rollback_params(thread_id: &Id, num_turns: u32) -> Value {
    json!({"threadId": thread_id.as_str(), "numTurns": num_turns})
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
            json!({
                "threadId": thread_id.as_str(),
                "objective": goal.objective,
                "status": goal.status,
                "tokenBudget": goal.token_budget,
            }),
        ),
        ThreadUpdate::Goal { goal: None } => {
            ("thread/goal/clear", json!({"threadId": thread_id.as_str()}))
        }
        ThreadUpdate::Settings { settings } => (
            "thread/settings/update",
            thread_settings_update_params(thread_id, &settings),
        ),
        ThreadUpdate::Section {
            section_id,
            position: _,
        } => (
            "thread/section/move",
            // This fallback is used only for append/remove. Positioned moves are resolved
            // asynchronously against the App Server's section order before dispatch.
            thread_section_move_params(thread_id, section_id.as_ref(), None),
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
    if method == "mcpServer/elicitation/request" {
        return elicitation_request(id, generation, thread_id, turn_id, params);
    }
    let thread_id =
        thread_id.ok_or_else(|| V2Error::source_unavailable("pending request omitted thread"))?;
    let turn_id =
        turn_id.ok_or_else(|| V2Error::source_unavailable("pending request omitted turn"))?;
    let item_id = source_id(params, "itemId", "pending request item id")?;
    let reason = optional_string(params, "reason")?;
    match method {
        "item/commandExecution/requestApproval" => Ok(PendingRequest::CommandApproval {
            id,
            generation: U64::new(generation),
            thread_id,
            turn_id,
            item_id,
            command: optional_string(params, "command")?,
            cwd: optional_string(params, "cwd")?,
            reason,
            network_approval_context_json: optional_json(params, "networkApprovalContext")?,
            available_decisions: approval_decisions(params)?,
        }),
        "item/fileChange/requestApproval" => Ok(PendingRequest::FileChangeApproval {
            id,
            generation: U64::new(generation),
            thread_id,
            turn_id,
            item_id,
            reason,
            grant_root: optional_string(params, "grantRoot")?,
            available_decisions: default_file_change_decisions(),
        }),
        "item/permissions/requestApproval" => Ok(PendingRequest::PermissionApproval {
            id,
            generation: U64::new(generation),
            thread_id,
            turn_id,
            item_id,
            reason,
            permissions: permission_profile(params.get("permissions").ok_or_else(|| {
                V2Error::source_unavailable("permission request omitted profile")
            })?)?,
        }),
        "item/tool/requestUserInput" => Ok(PendingRequest::UserInput {
            id,
            generation: U64::new(generation),
            thread_id,
            turn_id,
            item_id,
            questions: user_input_questions(params)?,
        }),
        _ => Err(V2Error::source_unavailable(
            "pending request method is unsupported",
        )),
    }
}
pub(super) fn pending_id(request: &PendingRequest) -> &Id {
    match request {
        PendingRequest::CommandApproval { id, .. }
        | PendingRequest::FileChangeApproval { id, .. }
        | PendingRequest::PermissionApproval { id, .. }
        | PendingRequest::UserInput { id, .. }
        | PendingRequest::Elicitation { id, .. } => id,
    }
}
pub(super) fn pending_thread_id(request: &PendingRequest) -> Option<&Id> {
    match request {
        PendingRequest::CommandApproval { thread_id, .. }
        | PendingRequest::FileChangeApproval { thread_id, .. }
        | PendingRequest::PermissionApproval { thread_id, .. }
        | PendingRequest::UserInput { thread_id, .. } => Some(thread_id),
        PendingRequest::Elicitation { thread_id, .. } => thread_id.as_ref(),
    }
}
pub(super) fn pending_generation(request: &PendingRequest) -> u64 {
    match request {
        PendingRequest::CommandApproval { generation, .. }
        | PendingRequest::FileChangeApproval { generation, .. }
        | PendingRequest::PermissionApproval { generation, .. }
        | PendingRequest::UserInput { generation, .. }
        | PendingRequest::Elicitation { generation, .. } => generation.get(),
    }
}
pub(super) fn resolution_result(
    request: &PendingRequest,
    resolution: RequestResolution,
) -> Result<Value, V2Error> {
    match (request, resolution) {
        (
            PendingRequest::CommandApproval {
                available_decisions,
                ..
            },
            RequestResolution::CommandApproval { decision },
        )
        | (
            PendingRequest::FileChangeApproval {
                available_decisions,
                ..
            },
            RequestResolution::FileChangeApproval { decision },
        ) => approval_resolution_result(available_decisions, &decision),
        (
            PendingRequest::PermissionApproval { .. },
            RequestResolution::PermissionApproval {
                permissions,
                scope,
                strict_auto_review,
            },
        ) => Ok(json!({
            "permissions": permission_profile_source(&permissions),
            "scope": scope,
            "strictAutoReview": strict_auto_review,
        })),
        (PendingRequest::UserInput { .. }, RequestResolution::UserInput { answers }) => {
            let answers = answers
                .into_iter()
                .map(|answer| {
                    (
                        answer.question_id.as_str().to_owned(),
                        json!({"answers": answer.answers}),
                    )
                })
                .collect::<serde_json::Map<_, _>>();
            Ok(json!({"answers": answers}))
        }
        (
            PendingRequest::Elicitation { .. },
            RequestResolution::Elicitation {
                action,
                content_json,
                metadata_json,
            },
        ) => Ok(json!({
            "action": action,
            "content": parse_optional_json(content_json, "elicitation content")?,
            "_meta": parse_optional_json(metadata_json, "elicitation metadata")?,
        })),
        _ => Err(V2Error::invalid_request(
            "request resolution kind does not match the pending request",
        )),
    }
}

fn approval_resolution_result(
    available_decisions: &[ApprovalDecision],
    decision: &ApprovalDecision,
) -> Result<Value, V2Error> {
    if !available_decisions.contains(decision) {
        return Err(V2Error::invalid_request(
            "approval decision was not offered by the App Server",
        ));
    }
    Ok(json!({"decision": decision}))
}

fn source_id(params: &Value, field: &str, label: &str) -> Result<Id, V2Error> {
    Id::new(
        params
            .get(field)
            .and_then(Value::as_str)
            .ok_or_else(|| V2Error::source_unavailable(format!("{label} is missing")))?
            .to_owned(),
    )
    .map_err(|_| V2Error::source_unavailable(format!("{label} is invalid")))
}

pub(super) fn optional_string(params: &Value, field: &str) -> Result<Option<String>, V2Error> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(V2Error::source_unavailable(format!(
            "pending request {field} is invalid"
        ))),
    }
}

fn optional_json(params: &Value, field: &str) -> Result<Option<String>, V2Error> {
    match params.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::to_string(value)
            .map(Some)
            .map_err(|_| V2Error::source_unavailable("pending request JSON is invalid")),
    }
}

fn approval_decisions(params: &Value) -> Result<Vec<ApprovalDecision>, V2Error> {
    match params.get("availableDecisions") {
        None | Some(Value::Null) => default_command_approval_decisions(params),
        Some(Value::Array(values)) => {
            if values.is_empty() || values.len() > 6 {
                return Err(V2Error::source_unavailable(
                    "command approval decisions are empty or exceed the supported limit",
                ));
            }
            let mut decisions = Vec::with_capacity(values.len());
            for value in values {
                let decision =
                    serde_json::from_value::<ApprovalDecision>(value.clone()).map_err(|_| {
                        V2Error::source_unavailable("command approval decision is invalid")
                    })?;
                validate_approval_decision(&decision)?;
                if decisions.contains(&decision) {
                    return Err(V2Error::source_unavailable(
                        "command approval decisions contain a duplicate",
                    ));
                }
                decisions.push(decision);
            }
            Ok(decisions)
        }
        Some(_) => Err(V2Error::source_unavailable(
            "command approval decisions are invalid",
        )),
    }
}

fn default_command_approval_decisions(params: &Value) -> Result<Vec<ApprovalDecision>, V2Error> {
    if params
        .get("networkApprovalContext")
        .is_some_and(|value| !value.is_null())
    {
        let mut decisions = vec![ApprovalDecision::Accept, ApprovalDecision::AcceptForSession];
        if let Some(amendment) = proposed_network_policy_amendments(params)?
            .into_iter()
            .find(|amendment| amendment.action == NetworkPolicyRuleAction::Allow)
        {
            decisions.push(ApprovalDecision::ApplyNetworkPolicyAmendment {
                network_policy_amendment: amendment,
            });
        }
        decisions.push(ApprovalDecision::Cancel);
        return Ok(decisions);
    }
    if params
        .get("additionalPermissions")
        .is_some_and(|value| !value.is_null())
    {
        return Ok(vec![ApprovalDecision::Accept, ApprovalDecision::Cancel]);
    }
    let mut decisions = vec![ApprovalDecision::Accept];
    if let Some(execpolicy_amendment) = proposed_execpolicy_amendment(params)? {
        decisions.push(ApprovalDecision::AcceptWithExecpolicyAmendment {
            execpolicy_amendment,
        });
    }
    decisions.push(ApprovalDecision::Cancel);
    Ok(decisions)
}

fn proposed_execpolicy_amendment(params: &Value) -> Result<Option<Vec<String>>, V2Error> {
    let Some(value) = params.get("proposedExecpolicyAmendment") else {
        return Ok(None);
    };
    if value.is_null() {
        return Ok(None);
    }
    let values = value
        .as_array()
        .ok_or_else(|| V2Error::source_unavailable("proposed execpolicy amendment is invalid"))?;
    if values.is_empty() || values.len() > 64 {
        return Err(V2Error::source_unavailable(
            "proposed execpolicy amendment is empty or exceeds the supported limit",
        ));
    }
    let mut amendment = Vec::with_capacity(values.len());
    for value in values {
        let entry = value.as_str().ok_or_else(|| {
            V2Error::source_unavailable("proposed execpolicy amendment entry is invalid")
        })?;
        if entry.is_empty() || entry.len() > 4_096 {
            return Err(V2Error::source_unavailable(
                "proposed execpolicy amendment entry exceeds the supported limit",
            ));
        }
        amendment.push(entry.to_owned());
    }
    Ok(Some(amendment))
}

fn proposed_network_policy_amendments(
    params: &Value,
) -> Result<Vec<NetworkPolicyAmendment>, V2Error> {
    let Some(value) = params.get("proposedNetworkPolicyAmendments") else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let values = value.as_array().ok_or_else(|| {
        V2Error::source_unavailable("proposed network policy amendments are invalid")
    })?;
    if values.len() > 64 {
        return Err(V2Error::source_unavailable(
            "proposed network policy amendments exceed the supported limit",
        ));
    }
    values
        .iter()
        .map(|value| {
            let amendment = serde_json::from_value::<NetworkPolicyAmendment>(value.clone())
                .map_err(|_| {
                    V2Error::source_unavailable("proposed network policy amendment is invalid")
                })?;
            validate_network_policy_amendment(&amendment)?;
            Ok(amendment)
        })
        .collect()
}

fn validate_approval_decision(decision: &ApprovalDecision) -> Result<(), V2Error> {
    match decision {
        ApprovalDecision::AcceptWithExecpolicyAmendment {
            execpolicy_amendment,
        } => {
            if execpolicy_amendment.is_empty()
                || execpolicy_amendment.len() > 64
                || execpolicy_amendment
                    .iter()
                    .any(|entry| entry.is_empty() || entry.len() > 4_096)
            {
                return Err(V2Error::source_unavailable(
                    "command approval execpolicy amendment is invalid",
                ));
            }
        }
        ApprovalDecision::ApplyNetworkPolicyAmendment {
            network_policy_amendment,
        } => validate_network_policy_amendment(network_policy_amendment)?,
        ApprovalDecision::Accept
        | ApprovalDecision::AcceptForSession
        | ApprovalDecision::Decline
        | ApprovalDecision::Cancel => {}
    }
    Ok(())
}

fn validate_network_policy_amendment(amendment: &NetworkPolicyAmendment) -> Result<(), V2Error> {
    if amendment.host.is_empty() || amendment.host.len() > 1_024 {
        return Err(V2Error::source_unavailable(
            "network policy amendment host is invalid",
        ));
    }
    Ok(())
}

fn default_file_change_decisions() -> Vec<ApprovalDecision> {
    vec![
        ApprovalDecision::Accept,
        ApprovalDecision::AcceptForSession,
        ApprovalDecision::Cancel,
    ]
}

fn user_input_questions(params: &Value) -> Result<Vec<UserInputQuestion>, V2Error> {
    let questions = params
        .get("questions")
        .and_then(Value::as_array)
        .ok_or_else(|| V2Error::source_unavailable("user input request omitted questions"))?;
    questions
        .iter()
        .map(|question| {
            let options = match question.get("options") {
                None | Some(Value::Null) => None,
                Some(Value::Array(options)) => Some(
                    options
                        .iter()
                        .map(|option| {
                            Ok(UserInputOption {
                                label: option
                                    .get("label")
                                    .and_then(Value::as_str)
                                    .ok_or_else(|| {
                                        V2Error::source_unavailable(
                                            "user input option omitted label",
                                        )
                                    })?
                                    .to_owned(),
                                description: option
                                    .get("description")
                                    .and_then(Value::as_str)
                                    .ok_or_else(|| {
                                        V2Error::source_unavailable(
                                            "user input option omitted description",
                                        )
                                    })?
                                    .to_owned(),
                            })
                        })
                        .collect::<Result<Vec<_>, V2Error>>()?,
                ),
                Some(_) => {
                    return Err(V2Error::source_unavailable(
                        "user input options are invalid",
                    ));
                }
            };
            Ok(UserInputQuestion {
                id: source_id(question, "id", "user input question id")?,
                header: required_string_field(question, "header", "user input question")?,
                question: required_string_field(question, "question", "user input question")?,
                is_other: required_bool_field(question, "isOther", "user input question")?,
                is_secret: required_bool_field(question, "isSecret", "user input question")?,
                options,
            })
        })
        .collect()
}

pub(super) fn required_string_field(
    value: &Value,
    field: &str,
    label: &str,
) -> Result<String, V2Error> {
    value
        .get(field)
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .ok_or_else(|| V2Error::source_unavailable(format!("{label} omitted {field}")))
}

fn required_bool_field(value: &Value, field: &str, label: &str) -> Result<bool, V2Error> {
    value
        .get(field)
        .and_then(Value::as_bool)
        .ok_or_else(|| V2Error::source_unavailable(format!("{label} omitted {field}")))
}

fn elicitation_request(
    id: Id,
    generation: u64,
    thread_id: Option<Id>,
    turn_id: Option<Id>,
    params: &Value,
) -> Result<PendingRequest, V2Error> {
    let mode = match params.get("mode").and_then(Value::as_str) {
        Some("form") => ElicitationMode::Form,
        Some("openai/form") => ElicitationMode::OpenaiForm,
        Some("url") => ElicitationMode::Url,
        _ => return Err(V2Error::source_unavailable("elicitation mode is invalid")),
    };
    let requested_schema = params.get("requestedSchema");
    Ok(PendingRequest::Elicitation {
        id,
        generation: U64::new(generation),
        thread_id,
        turn_id,
        server_name: required_string_field(params, "serverName", "elicitation")?,
        mode,
        message: required_string_field(params, "message", "elicitation")?,
        url: optional_string(params, "url")?,
        elicitation_id: optional_string(params, "elicitationId")?
            .map(Id::new)
            .transpose()
            .map_err(|_| V2Error::source_unavailable("elicitation id is invalid"))?,
        fields: requested_schema.map_or_else(|| Ok(Vec::new()), elicitation_fields)?,
        requested_schema_json: requested_schema
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| V2Error::source_unavailable("elicitation schema is invalid"))?,
        metadata_json: optional_json(params, "_meta")?,
    })
}

fn elicitation_fields(schema: &Value) -> Result<Vec<ElicitationField>, V2Error> {
    let required = schema
        .get("required")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<HashSet<_>>();
    let Some(properties) = schema.get("properties").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };
    properties
        .iter()
        .map(|(id, field)| {
            let options = elicitation_options(field);
            let field_type = match field.get("type").and_then(Value::as_str) {
                Some("boolean") => ElicitationFieldType::Boolean,
                Some("number") => ElicitationFieldType::Number,
                Some("integer") => ElicitationFieldType::Integer,
                Some("array") => ElicitationFieldType::Array,
                Some("secret") => ElicitationFieldType::Secret,
                Some("string") if options.is_some() => ElicitationFieldType::Select,
                _ => ElicitationFieldType::Text,
            };
            Ok(ElicitationField {
                id: Id::new(id.clone())
                    .map_err(|_| V2Error::source_unavailable("elicitation field id is invalid"))?,
                label: field
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(id)
                    .to_owned(),
                description: field
                    .get("description")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned),
                field_type,
                required: required.contains(id.as_str()),
                default_value: elicitation_default(field, field_type),
                options,
            })
        })
        .collect()
}

fn elicitation_default(field: &Value, field_type: ElicitationFieldType) -> ElicitationDefault {
    let Some(value) = field.get("default") else {
        return ElicitationDefault::Unset;
    };
    let value = if value.is_null() {
        Some(ElicitationValue::Null)
    } else {
        match field_type {
            ElicitationFieldType::Boolean => value.as_bool().map(ElicitationValue::Boolean),
            ElicitationFieldType::Number | ElicitationFieldType::Integer => {
                value.as_number().cloned().map(ElicitationValue::Number)
            }
            ElicitationFieldType::Array => value.as_array().and_then(|values| {
                values
                    .iter()
                    .map(Value::as_str)
                    .map(|entry| entry.map(ToOwned::to_owned))
                    .collect::<Option<Vec<_>>>()
                    .map(ElicitationValue::StringArray)
            }),
            ElicitationFieldType::Text
            | ElicitationFieldType::Secret
            | ElicitationFieldType::Select => value
                .as_str()
                .map(ToOwned::to_owned)
                .map(ElicitationValue::String),
        }
    };
    value.map_or(ElicitationDefault::Unset, |value| {
        ElicitationDefault::Value { value }
    })
}

fn elicitation_options(field: &Value) -> Option<Vec<ElicitationOption>> {
    let choice_schema = if field.get("type").and_then(Value::as_str) == Some("array") {
        field.get("items")?
    } else {
        field
    };
    if let Some(values) = choice_schema.get("enum").and_then(Value::as_array) {
        let labels = choice_schema.get("enumNames").and_then(Value::as_array);
        return Some(
            values
                .iter()
                .enumerate()
                .filter_map(|(index, value)| {
                    let value = value.as_str()?.to_owned();
                    let label = labels
                        .and_then(|entries| entries.get(index))
                        .and_then(Value::as_str)
                        .unwrap_or(&value)
                        .to_owned();
                    Some(ElicitationOption { value, label })
                })
                .collect(),
        );
    }
    let choices = choice_schema
        .get("oneOf")
        .or_else(|| choice_schema.get("anyOf"))
        .and_then(Value::as_array)?;
    Some(
        choices
            .iter()
            .filter_map(|choice| {
                let value = choice.get("const").and_then(Value::as_str)?.to_owned();
                let label = choice
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or(&value)
                    .to_owned();
                Some(ElicitationOption { value, label })
            })
            .collect(),
    )
}

fn parse_optional_json(value: Option<String>, label: &str) -> Result<Value, V2Error> {
    value.map_or(Ok(Value::Null), |value| {
        serde_json::from_str(&value)
            .map_err(|_| V2Error::invalid_request(format!("{label} is not valid JSON")))
    })
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
    use super::super::capabilities::{authorize_command, authorize_query};
    use super::*;

    fn id(value: &str) -> Id {
        Id::new(value).unwrap_or_else(|error| panic!("invalid test id: {error}"))
    }

    #[test]
    fn paired_session_authorizes_sensitive_families() {
        let paired = AuthorizationContext::Session {
            device_id: "device".into(),
            expires_at: u64::MAX,
        };
        let sensitive_queries = [
            Query::ThreadResources {
                thread_id: id("thread"),
                scope: ResourceScope::Session,
                cursor: None,
                limit: 100,
            },
            Query::ThreadChange {
                thread_id: id("thread"),
                path: "src/main.rs".into(),
                scope: ResourceScope::Session,
            },
            Query::ProjectsList,
            Query::WorkspaceInspect {
                path: "/tmp".into(),
            },
            Query::QueueList {
                thread_id: None,
                cursor: None,
                limit: 100,
            },
            Query::AccountsList,
        ];
        for query in &sensitive_queries {
            assert!(authorize_query(&paired, query).is_ok());
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
                    expected_revision: "revision".into(),
                },
            },
            Command::AccountUpdate {
                change: AccountChange::Activate {
                    profile_id: id("profile"),
                },
            },
        ];
        for command in &sensitive_commands {
            assert!(authorize_command(&paired, command).is_ok());
        }
    }
}
