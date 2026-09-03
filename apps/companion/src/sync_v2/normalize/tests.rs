//! Regression coverage for semantic normalization.

use super::*;
use crate::sync_v2::domain::{
    ExecutionState, FileChangeKind, FileChangeState, ImageDetail, Item, LifecyclePhase,
    ThreadGoalStatus, ThreadState, UserMessageBlock,
};
use serde_json::json;

fn source_thread(settings: &Value) -> Value {
    let mut thread = json!({
        "id": "thread",
        "preview": "",
        "cwd": "/workspace",
        "status": {"type": "idle"},
        "createdAt": "2026-08-27T00:00:00Z",
        "updatedAt": "2026-08-27T00:00:00Z"
    });
    let object = thread
        .as_object_mut()
        .unwrap_or_else(|| panic!("test thread must be an object"));
    object.extend(
        settings
            .as_object()
            .unwrap_or_else(|| panic!("test settings must be an object"))
            .clone(),
    );
    thread
}

#[test]
fn goal_preserves_authoritative_status_budget_and_usage() {
    let goal = thread_goal(&json!({
        "threadId": "thread",
        "objective": "Ship V2",
        "status": "usageLimited",
        "tokenBudget": 1000,
        "tokensUsed": 750,
        "timeUsedSeconds": 42,
        "createdAt": 100,
        "updatedAt": 200
    }))
    .unwrap_or_else(|error| panic!("goal must normalize: {error:?}"));

    assert_eq!(goal.thread_id.as_str(), "thread");
    assert_eq!(goal.status, ThreadGoalStatus::UsageLimited);
    assert_eq!(goal.token_budget, Some(1000));
    assert_eq!(goal.tokens_used, 750);
    assert_eq!(goal.time_used_seconds, 42);
    assert_eq!(goal.created_at_ms, 100);
    assert_eq!(goal.updated_at_ms, 200);
}

#[test]
fn goal_rejects_missing_usage_instead_of_fabricating_zero() {
    let Err(error) = thread_goal(&json!({
        "threadId": "thread",
        "objective": "Ship V2",
        "status": "active",
        "tokenBudget": null,
        "timeUsedSeconds": 42,
        "createdAt": 100,
        "updatedAt": 200
    })) else {
        panic!("missing usage must fail closed");
    };

    assert_eq!(
        error.code,
        super::super::protocol::ErrorCode::SourceUnavailable
    );
}

#[test]
fn rich_activity_shapes_survive_without_source_shape_guessing() {
    let reasoning = item(&json!({
        "type": "reasoning",
        "id": "reasoning",
        "summary": ["first", "second"],
        "content": ["detail"]
    }))
    .unwrap_or_else(|error| panic!("reasoning must normalize: {error:?}"));
    assert!(matches!(reasoning, Item::Reasoning {
        summary_parts: Some(parts),
        content_parts: Some(content),
        ..
    } if parts == ["first", "second"] && content == ["detail"]));

    let file_change = item(&json!({
        "type": "fileChange",
        "id": "change",
        "status": "completed",
        "changes": [{"path": "src/main.rs", "kind": {"type": "update", "move_path": null}, "diff": "@@"}]
    }))
    .unwrap_or_else(|error| panic!("file change must normalize: {error:?}"));
    assert!(matches!(file_change, Item::FileChange {
        path,
        change: FileChangeKind::Update,
        changes: Some(changes),
        ..
    } if path == "src/main.rs" && changes.len() == 1));

    assert!(matches!(
        item(&json!({"type": "contextCompaction", "id": "compaction"})),
        Ok(Item::ContextCompaction { .. })
    ));
    assert!(matches!(
        item(&json!({"type": "futureItem", "id": "future"})),
        Ok(Item::Unsupported { source_kind, .. }) if source_kind == "futureItem"
    ));
}

#[test]
fn tool_items_preserve_canonical_mcp_context_error_and_dynamic_success() {
    let mcp = item(&json!({
        "type": "mcpToolCall",
        "id": "mcp",
        "server": "design",
        "tool": "inspect",
        "status": "failed",
        "arguments": {"documentId": "doc"},
        "appContext": {
            "connectorId": "connector",
            "linkId": "link",
            "resourceUri": "app://document/doc",
            "appName": "Design",
            "actionName": "Inspect"
        },
        "pluginId": "plugin.design",
        "readOnlyHint": true,
        "result": null,
        "error": {"message": "source rejected document doc"},
        "durationMs": 42
    }))
    .unwrap_or_else(|error| panic!("MCP item must normalize: {error:?}"));
    assert!(matches!(
        &mcp,
        Item::Tool {
            app_context: Some(context),
            plugin_id: Some(plugin_id),
            read_only_hint: Some(true),
            success: None,
            error: Some(error),
            ..
        } if context.connector_id == "connector"
            && context.link_id.as_deref() == Some("link")
            && context.resource_uri.as_deref() == Some("app://document/doc")
            && context.app_name.as_deref() == Some("Design")
            && context.action_name.as_deref() == Some("Inspect")
            && plugin_id == "plugin.design"
            && error.message == "source rejected document doc"
    ));
    let mcp_wire = serde_json::to_value(&mcp)
        .unwrap_or_else(|error| panic!("MCP tool should serialize: {error:?}"));
    assert!(mcp_wire.get("appContext").is_some_and(Value::is_object));
    assert_eq!(mcp_wire.get("pluginId"), Some(&json!("plugin.design")));
    assert_eq!(mcp_wire.get("readOnlyHint"), Some(&json!(true)));
    assert!(mcp_wire.get("error").is_some_and(Value::is_object));
    assert_eq!(
        serde_json::from_value::<Item>(mcp_wire)
            .unwrap_or_else(|error| panic!("MCP tool should deserialize: {error:?}")),
        mcp
    );

    let dynamic = item(&json!({
        "type": "dynamicToolCall",
        "id": "dynamic",
        "namespace": null,
        "tool": "render",
        "status": "completed",
        "arguments": {"scene": "one"},
        "contentItems": [],
        "success": false,
        "durationMs": 7
    }))
    .unwrap_or_else(|error| panic!("dynamic item must normalize: {error:?}"));
    assert!(matches!(
        &dynamic,
        Item::Tool {
            app_context: None,
            plugin_id: None,
            read_only_hint: None,
            success: Some(false),
            error: None,
            ..
        }
    ));
    let wire = serde_json::to_value(&dynamic)
        .unwrap_or_else(|error| panic!("normalized tool should serialize: {error:?}"));
    assert!(wire.get("appContext").is_none());
    assert!(wire.get("pluginId").is_none());
    assert!(wire.get("readOnlyHint").is_none());
    assert_eq!(wire.get("success"), Some(&json!(false)));
    assert!(wire.get("error").is_none());
    assert_eq!(
        serde_json::from_value::<Item>(wire)
            .unwrap_or_else(|error| panic!("dynamic tool should deserialize: {error:?}")),
        dynamic
    );
}

#[test]
fn unsupported_item_keeps_a_bounded_sanitized_recovery_payload() {
    let unsupported = item(&json!({
        "type": "futureItem",
        "id": "future",
        "description": "useful diagnostic",
        "nested": {
            "authorization": "Bearer private",
            "x-auth-token": "private token",
            "value": 42
        }
    }))
    .unwrap_or_else(|error| panic!("unsupported item must normalize: {error:?}"));

    let Item::Unsupported {
        payload_json,
        payload_truncated,
        ..
    } = unsupported
    else {
        panic!("future item must remain visible as unsupported");
    };
    assert!(payload_truncated);
    assert!(payload_json.contains("useful diagnostic"));
    assert!(payload_json.contains("[redacted]"));
    assert!(!payload_json.contains("Bearer private"));
    assert!(!payload_json.contains("private token"));
    assert!(payload_json.len() <= 65_536);
    assert!(serde_json::from_str::<Value>(&payload_json).is_ok());
}

#[test]
fn app_server_item_defaults_and_required_fields_are_not_guessed() {
    let reasoning = item(&json!({
        "type": "reasoning",
        "id": "reasoning"
    }))
    .unwrap_or_else(|error| panic!("schema-defaulted reasoning must normalize: {error:?}"));
    assert!(matches!(
        reasoning,
        Item::Reasoning {
            summary_parts: Some(summary),
            content_parts: Some(content),
            ..
        } if summary.is_empty() && content.is_empty()
    ));

    for malformed in [
        json!({
            "type": "userMessage",
            "id": "user",
            "content": [{"type": "futureInput", "text": "hidden"}]
        }),
        json!({
            "type": "plan",
            "id": "plan"
        }),
        json!({
            "type": "fileChange",
            "id": "change",
            "status": "completed",
            "changes": [{"path": "file.rs", "kind": {"type": "update"}}]
        }),
        json!({
            "type": "collabAgentToolCall",
            "id": "collaboration",
            "tool": "spawnAgent",
            "status": "completed",
            "senderThreadId": "root",
            "receiverThreadIds": [],
            "agentsStates": []
        }),
    ] {
        assert!(
            item(&malformed).is_err(),
            "accepted malformed item {malformed}"
        );
    }
}

#[test]
fn user_message_preserves_every_canonical_input_block_in_source_order() {
    let normalized = item(&json!({
        "type": "userMessage",
        "id": "user",
        "clientId": "client-message",
        "content": [
            {
                "type": "text",
                "text": "Question",
                "text_elements": [{
                    "byteRange": {"start": 0, "end": 8},
                    "placeholder": "Prompt"
                }]
            },
            {"type": "image", "url": "https://example.test/image.png", "detail": "original"},
            {"type": "localImage", "path": "/workspace/image.png", "detail": "high"},
            {"type": "audio", "url": "data:audio/wav;base64,AAA"},
            {"type": "localAudio", "path": "/workspace/audio.wav"},
            {"type": "skill", "name": "review", "path": "/skills/review/SKILL.md"},
            {"type": "mention", "name": "plan.md", "path": "/workspace/plan.md"}
        ]
    }))
    .unwrap_or_else(|error| panic!("canonical user message must normalize: {error:?}"));

    let Item::UserMessage {
        client_id, content, ..
    } = normalized
    else {
        panic!("user message must remain a structured user message");
    };
    assert_eq!(client_id.as_deref(), Some("client-message"));
    assert_eq!(content.len(), 7);
    assert!(matches!(
        content.as_slice(),
        [
            UserMessageBlock::Text { .. },
            UserMessageBlock::Image {
                detail: Some(ImageDetail::Original),
                ..
            },
            UserMessageBlock::LocalImage {
                detail: Some(ImageDetail::High),
                ..
            },
            UserMessageBlock::Audio { .. },
            UserMessageBlock::LocalAudio { .. },
            UserMessageBlock::Skill { .. },
            UserMessageBlock::Mention { .. },
        ]
    ));
}

#[test]
fn user_message_rejects_an_invalid_text_element_range() {
    let result = item(&json!({
        "type": "userMessage",
        "id": "user",
        "content": [{
            "type": "text",
            "text": "short",
            "text_elements": [{
                "byteRange": {"start": 0, "end": 99},
                "placeholder": null
            }]
        }]
    }));

    assert!(result.is_err());
}

#[test]
fn workspace_create_capability_becomes_creatable_v2_support() {
    let support = workspace_support(&json!({
        "support": {
            "capability": "workspace.create@1",
            "displayName": "Git worktree",
            "provider": "git",
            "repositoryRoot": "/workspace/project"
        }
    }))
    .unwrap_or_else(|error| panic!("workspace support should normalize: {error:?}"))
    .unwrap_or_else(|| panic!("workspace support should be present"));

    assert!(support.can_create);
    assert_eq!(support.provider.as_str(), "git");
    assert_eq!(support.repository_root, "/workspace/project");
}

#[test]
fn workspace_support_rejects_an_unrelated_capability() {
    assert!(
        workspace_support(&json!({
            "support": {
                "capability": "workspace.inspect@1",
                "provider": "git",
                "repositoryRoot": "/workspace/project"
            }
        }))
        .unwrap_or_else(|error| panic!("workspace support should normalize: {error:?}"))
        .is_none()
    );
}

#[test]
fn source_settings_accept_only_proven_source_spellings() {
    let accepted = source_thread(&json!({
        "model": null,
        "reasoningEffort": "xhigh",
        "approvalPolicy": "on-request",
        "sandboxPolicy": {"type": "workspaceWrite"}
    }));
    let summary = thread_summary(&accepted)
        .unwrap_or_else(|error| panic!("source settings should normalize: {error:?}"));
    let settings = summary
        .settings
        .unwrap_or_else(|| panic!("source settings should be present"));
    assert_eq!(settings.effort, Some(Effort::Xhigh));
    assert_eq!(settings.approval_policy, ApprovalPolicy::OnRequest);
    assert_eq!(settings.sandbox, Sandbox::WorkspaceWrite);

    for rejected in [
        json!({
            "approvalPolicy": "onRequest",
            "sandbox": "workspace-write"
        }),
        json!({
            "approvalPolicy": "never",
            "sandboxPolicy": {"type": "unknown"}
        }),
        json!({
            "approvalPolicy": "never",
            "sandbox": "read-only",
            "effort": "extreme"
        }),
    ] {
        assert!(thread_summary(&source_thread(&rejected)).is_err());
    }
}

#[test]
fn thread_list_and_read_records_without_settings_remain_truthful() {
    let summary = thread_summary(&source_thread(&json!({ "preview": "Newest answer" })))
        .unwrap_or_else(|error| panic!("real thread DTO should normalize: {error:?}"));
    assert_eq!(summary.settings, None);
    assert_eq!(summary.preview, "Newest answer");
}

#[test]
fn app_server_placeholder_title_does_not_override_the_canonical_preview() {
    let summary = thread_summary(&source_thread(&json!({
        "title": "Untitled thread",
        "preview": "Newest answer"
    })))
    .unwrap_or_else(|error| panic!("placeholder title should normalize: {error:?}"));

    assert_eq!(summary.title, None);
    assert_eq!(summary.preview, "Newest answer");
}

#[test]
fn catalog_partition_supplies_archived_state_missing_from_thread_dto() {
    let summary = thread_summary_in_partition(&source_thread(&json!({})), true)
        .unwrap_or_else(|error| panic!("catalog thread should normalize: {error:?}"));
    assert!(summary.archived);
}

#[test]
fn subagent_spawn_parent_is_restored_from_canonical_source_metadata() {
    let summary = thread_summary(&source_thread(&json!({
        "parentThreadId": null,
        "source": {
            "subAgent": {
                "thread_spawn": {
                    "parent_thread_id": "root-thread",
                    "depth": 1,
                    "agent_path": null,
                    "agent_nickname": null,
                    "agent_role": null
                }
            }
        }
    })))
    .unwrap_or_else(|error| panic!("subagent thread should normalize: {error:?}"));

    assert_eq!(
        summary.parent_id.as_ref().map(Id::as_str),
        Some("root-thread")
    );
}

#[test]
fn user_catalog_visibility_rejects_children_subagents_and_ephemeral_threads() {
    assert!(is_user_catalog_thread(&source_thread(&json!({}))));
    assert!(!is_user_catalog_thread(&source_thread(&json!({
        "parentThreadId": "root-thread"
    }))));
    assert!(!is_user_catalog_thread(&source_thread(&json!({
        "source": {"subAgent": "review"}
    }))));
    assert!(!is_user_catalog_thread(&source_thread(&json!({
        "source": {"subagent": {"other": "legacy spelling"}}
    }))));
    assert!(!is_user_catalog_thread(&source_thread(&json!({
        "ephemeral": true
    }))));
}

#[test]
fn response_level_settings_are_attached_to_the_nested_thread() {
    let response = json!({
        "thread": source_thread(&json!({})),
        "model": "gpt-5.6",
        "reasoningEffort": "high",
        "approvalPolicy": "never",
        "sandbox": {"type": "dangerFullAccess"}
    });
    let summary = thread_summary_from_response(&response)
        .unwrap_or_else(|error| panic!("response settings should normalize: {error:?}"));
    let settings = summary
        .settings
        .unwrap_or_else(|| panic!("response settings should be present"));
    assert_eq!(settings.model.as_deref(), Some("gpt-5.6"));
    assert_eq!(settings.effort, Some(Effort::High));
    assert_eq!(settings.approval_policy, ApprovalPolicy::Never);
    assert_eq!(settings.sandbox, Sandbox::Unrestricted);
}

#[test]
fn model_catalog_keeps_reasoning_efforts_from_the_app_server_shape() {
    let catalog = models(&json!({
        "data": [{
            "id": "model-record",
            "model": "gpt-5.6-sol",
            "displayName": "GPT-5.6 Sol",
            "supportedReasoningEfforts": [
                {"reasoningEffort": "medium", "description": "Balanced"},
                {"reasoningEffort": "high", "description": "More reasoning"},
                {"reasoningEffort": "xhigh", "description": "Maximum reasoning"}
            ],
            "defaultReasoningEffort": "high"
        }]
    }))
    .unwrap_or_else(|error| panic!("model catalog should normalize: {error:?}"));

    let model = catalog
        .first()
        .unwrap_or_else(|| panic!("model should normalize"));
    assert_eq!(model.id.as_str(), "gpt-5.6-sol");
    assert_eq!(model.efforts, [Effort::Medium, Effort::High, Effort::Xhigh]);
    assert_eq!(model.default_effort.as_deref(), Some("high"));
    assert!(!model.supports_personality);
}

#[test]
fn generated_effort_and_granular_approval_values_are_preserved() {
    let catalog = models(&json!({
        "data": [{
            "model": "gpt-future",
            "displayName": "GPT Future",
            "supportedReasoningEfforts": [
                {"reasoningEffort": "none"},
                {"reasoningEffort": "minimal"},
                {"reasoningEffort": "max"},
                {"reasoningEffort": "ultra"}
            ],
            "defaultReasoningEffort": "ultra",
            "supportsPersonality": false
        }]
    }))
    .unwrap_or_else(|error| panic!("generated efforts should normalize: {error:?}"));
    assert_eq!(
        catalog[0].efforts,
        [Effort::None, Effort::Minimal, Effort::Max, Effort::Ultra]
    );

    let summary = thread_summary(&source_thread(&json!({
        "reasoningEffort": "ultra",
        "approvalPolicy": {
            "granular": {
                "sandbox_approval": true,
                "rules": false,
                "skill_approval": true,
                "request_permissions": false,
                "mcp_elicitations": true
            }
        },
        "sandbox": {"type": "workspace-write"}
    })))
    .unwrap_or_else(|error| panic!("granular settings should normalize: {error:?}"));
    let settings = summary
        .settings
        .unwrap_or_else(|| panic!("settings should be present"));
    assert_eq!(settings.effort, Some(Effort::Ultra));
    assert!(matches!(
        settings.approval_policy,
        ApprovalPolicy::Granular(config)
            if config.sandbox_approval
                && !config.rules
                && config.skill_approval
                && !config.request_permissions
                && config.mcp_elicitations
    ));
}

#[test]
fn canonical_thread_status_preserves_waiting_and_system_error_states() {
    let cases = [
        (
            json!({"type": "active", "activeFlags": ["waitingOnApproval"]}),
            ThreadState::WaitingForApproval,
        ),
        (
            json!({"type": "active", "activeFlags": ["waitingOnUserInput"]}),
            ThreadState::WaitingForInput,
        ),
        (
            json!({"type": "active", "activeFlags": []}),
            ThreadState::Running,
        ),
        (json!({"type": "systemError"}), ThreadState::Failed),
    ];
    for (status, expected) in cases {
        let summary = thread_summary(&source_thread(&json!({"status": status})))
            .unwrap_or_else(|error| panic!("canonical status should normalize: {error:?}"));
        assert_eq!(summary.state, expected);
    }
    assert!(
        thread_summary(&source_thread(&json!({
            "status": {"type": "active", "activeFlags": ["futureFlag"]}
        })))
        .is_err()
    );
}

#[test]
fn command_decline_and_file_change_shapes_do_not_lie_about_status_or_kind() {
    let command = item(&json!({
        "type": "commandExecution",
        "id": "command",
        "command": "false",
        "cwd": "/workspace",
        "status": "declined",
        "aggregatedOutput": null,
        "exitCode": null,
        "durationMs": null
    }))
    .unwrap_or_else(|error| panic!("declined command should normalize: {error:?}"));
    assert!(matches!(
        command,
        Item::Command {
            status: ExecutionState::Failed,
            ..
        }
    ));

    for (kind, status, expected_kind, expected_state) in [
        (
            json!({"type": "add"}),
            "completed",
            FileChangeKind::Add,
            FileChangeState::Applied,
        ),
        (
            json!({"type": "delete"}),
            "declined",
            FileChangeKind::Delete,
            FileChangeState::Rejected,
        ),
    ] {
        let change = item(&json!({
            "type": "fileChange",
            "id": "change",
            "status": status,
            "changes": [{"path": "file.rs", "kind": kind, "diff": "patch"}]
        }))
        .unwrap_or_else(|error| panic!("file change should normalize: {error:?}"));
        assert!(matches!(
            change,
            Item::FileChange {
                change,
                status,
                ..
            } if change == expected_kind && status == expected_state
        ));
    }
}

#[test]
fn malformed_authoritative_collections_fail_as_a_whole() {
    assert!(
        models(&json!({
            "data": [{
                "model": "model",
                "displayName": "Model",
                "supportedReasoningEfforts": [{"reasoningEffort": "future"}],
                "defaultReasoningEffort": "future",
                "supportsPersonality": false
            }]
        }))
        .is_err()
    );
    assert!(
        queue_items(&json!({
            "items": [{
                "commandId": "command",
                "remoteThreadId": "thread",
                "order": "not-a-number",
                "state": "queued",
                "params": {"input": []},
                "lastError": null
            }]
        }))
        .is_err()
    );
    assert!(
        queue_items(&json!({
            "items": [{
                "commandId": "command",
                "remoteThreadId": "thread",
                "order": 1,
                "state": "queued",
                "params": {"input": [{"type": "future"}]},
                "lastError": null
            }]
        }))
        .is_err()
    );
    assert!(
        resource_changes(&json!({
            "changes": [{"path": "file", "kind": "future", "additions": 0, "deletions": 0}]
        }))
        .is_err()
    );
}

#[test]
fn queue_item_preserves_the_authoritative_failure_message() {
    let message = "observer rejected operation: invalid cwd `/srv/project` (code E_CWD_17)";
    let items = queue_items(&json!({
        "items": [{
            "commandId": "command",
            "remoteThreadId": "thread",
            "order": 1,
            "state": "failed",
            "params": {"input": [{"type": "text", "text": "retry this"}]},
            "lastError": message
        }]
    }))
    .unwrap_or_else(|error| panic!("failed queue item should normalize: {error:?}"));

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].last_error.as_deref(), Some(message));
}

#[test]
fn malformed_turn_item_fails_the_authoritative_turn() {
    let source = json!({
        "id": "turn",
        "status": "completed",
        "startedAt": 1_788_000_000,
        "completedAt": 1_788_000_001,
        "durationMs": 1_000,
        "items": [{"type": "agentMessage", "id": "message"}]
    });
    assert!(
        turn_view(
            &Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}")),
            &source
        )
        .is_err()
    );
}

#[test]
fn snapshot_and_live_lifecycle_are_equivalent_across_reconnect() {
    let source_items = vec![
        json!({
            "type": "reasoning",
            "id": "pre-turn-reasoning",
            "summary": ["Preparing session"],
            "content": []
        }),
        json!({
            "type": "userMessage",
            "id": "user",
            "clientId": "client-user",
            "content": [{"type": "text", "text": "Question", "text_elements": []}]
        }),
        json!({
            "type": "agentMessage",
            "id": "agent",
            "text": "Answer",
            "phase": "final_answer",
            "memoryCitation": {
                "entries": [{
                    "path": "MEMORY.md",
                    "lineStart": 10,
                    "lineEnd": 12,
                    "note": "reconnect rule"
                }],
                "threadIds": ["source-thread"]
            }
        }),
    ];
    let turn = turn_view(
        &Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}")),
        &json!({
            "id": "turn",
            "status": "completed",
            "startedAt": "2026-09-03T00:00:00Z",
            "completedAt": "2026-09-03T00:00:01Z",
            "items": source_items
        }),
    )
    .unwrap_or_else(|error| panic!("snapshot turn should normalize: {error:?}"));

    let expected = turn
        .items
        .iter()
        .cloned()
        .enumerate()
        .map(|(index, item)| item_lifecycle(item, LifecyclePhase::Completed, index == 0))
        .collect::<Vec<_>>();
    assert_eq!(turn.lifecycle, expected);
    assert!(matches!(
        &turn.items[2],
        Item::AssistantText {
            memory_citation: Some(citation),
            ..
        } if citation.entries[0].path == "MEMORY.md"
            && citation.entries[0].line_start == 10
            && citation.entries[0].line_end == 12
            && citation.thread_ids[0].as_str() == "source-thread"
    ));
}

#[test]
fn historical_images_preserve_private_preview_sources() {
    let viewed = item(&json!({
        "type": "imageView",
        "id": "viewed",
        "path": "/tmp/render one.png"
    }))
    .unwrap_or_else(|error| panic!("image view should normalize: {error:?}"));
    assert!(matches!(
        viewed,
        Item::ImageView { path, source_url, .. }
            if path == "/tmp/render one.png"
                && source_url == "/v2/files/preview?path=%2Ftmp%2Frender%20one%2Epng"
    ));

    let generated = item(&json!({
        "type": "imageGeneration",
        "id": "generated",
        "status": "completed",
        "revisedPrompt": "A diagram",
        "result": "https://example.com/transient.png",
        "savedPath": "/tmp/generated.png"
    }))
    .unwrap_or_else(|error| panic!("image generation should normalize: {error:?}"));
    assert!(matches!(
        generated,
        Item::ImageGeneration {
            result,
            saved_path: Some(saved_path),
            source_url: Some(source_url),
            ..
        } if result == "https://example.com/transient.png"
            && saved_path == "/tmp/generated.png"
            && source_url == "/v2/files/preview?path=%2Ftmp%2Fgenerated%2Epng"
    ));

    let unsaved = item(&json!({
        "type": "imageGeneration",
        "id": "unsaved",
        "status": "completed",
        "result": "https://example.com/transient.png",
        "savedPath": null
    }))
    .unwrap_or_else(|error| panic!("unsaved image generation should normalize: {error:?}"));
    assert!(matches!(
        unsaved,
        Item::ImageGeneration {
            saved_path: None,
            source_url: None,
            ..
        }
    ));
}

#[test]
fn active_snapshot_keeps_the_started_pre_turn_phase() {
    let turn = turn_view(
        &Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}")),
        &json!({
            "id": "turn",
            "status": "inProgress",
            "startedAt": "2026-09-03T00:00:00Z",
            "completedAt": null,
            "items": [{
                "type": "commandExecution",
                "id": "command",
                "command": "pwd",
                "cwd": "/workspace",
                "status": "inProgress",
                "aggregatedOutput": null,
                "exitCode": null,
                "durationMs": null
            }]
        }),
    )
    .unwrap_or_else(|error| panic!("active snapshot should normalize: {error:?}"));

    assert!(matches!(
        turn.lifecycle.as_slice(),
        [lifecycle] if lifecycle.phase == LifecyclePhase::Started && lifecycle.pre_turn
    ));
}

#[test]
fn reconnect_snapshot_keeps_lifecycle_identity_and_pre_turn_position() {
    let thread_id = Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}"));
    let source_items = json!([
        {
            "type": "reasoning",
            "id": "pre-turn-reasoning",
            "summary": ["Preparing session"],
            "content": []
        },
        {
            "type": "userMessage",
            "id": "user",
            "clientId": "client-user",
            "content": [{"type": "text", "text": "Question", "text_elements": []}]
        },
        {
            "type": "commandExecution",
            "id": "command",
            "command": "pwd",
            "cwd": "/workspace",
            "status": "inProgress",
            "aggregatedOutput": null,
            "exitCode": null,
            "durationMs": null
        }
    ]);
    let active = turn_view(
        &thread_id,
        &json!({
            "id": "turn",
            "status": "inProgress",
            "startedAt": "2026-09-03T00:00:00Z",
            "completedAt": null,
            "items": source_items.clone()
        }),
    )
    .unwrap_or_else(|error| panic!("active snapshot should normalize: {error:?}"));

    let mut completed_items = source_items;
    completed_items[2]["status"] = json!("completed");
    let reconnected = turn_view(
        &thread_id,
        &json!({
            "id": "turn",
            "status": "completed",
            "startedAt": "2026-09-03T00:00:00Z",
            "completedAt": "2026-09-03T00:00:01Z",
            "items": completed_items
        }),
    )
    .unwrap_or_else(|error| panic!("reconnect snapshot should normalize: {error:?}"));

    let lifecycle_identity = |turn: &crate::sync_v2::domain::TurnView| {
        turn.lifecycle
            .iter()
            .map(|lifecycle| {
                let encoded = serde_json::to_value(&lifecycle.item)
                    .unwrap_or_else(|error| panic!("lifecycle item should serialize: {error:?}"));
                let id = encoded
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_else(|| panic!("lifecycle item should carry an id"))
                    .to_owned();
                (id, lifecycle.pre_turn)
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        lifecycle_identity(&active),
        lifecycle_identity(&reconnected)
    );
    assert_eq!(active.lifecycle[2].phase, LifecyclePhase::Started);
    assert!(
        reconnected
            .lifecycle
            .iter()
            .all(|lifecycle| lifecycle.phase == LifecyclePhase::Completed)
    );
}

#[test]
fn canonical_turn_display_metadata_survives_v2_normalization() {
    let source = json!({
        "id": "turn",
        "createdAt": "2026-08-27T11:59:00Z",
        "startedAt": "2026-08-27T12:00:00Z",
        "completedAt": "2026-08-27T12:00:03Z",
        "durationMs": 3200,
        "status": "completed",
        "items": [
            {"type": "userMessage", "id": "user", "content": [{"type": "text", "text": "Question"}]},
            {"type": "agentMessage", "id": "agent", "text": "Answer"}
        ],
        "codewide": {
            "activity": {"count": 2, "kinds": ["reasoning", "commandExecution"]},
            "usage": {
                "latestRequest": {"totalTokens": 25_700},
                "modelContextWindow": 258_400,
                "turn": {
                    "tokens": {
                        "inputTokens": 26_000,
                        "cachedInputTokens": 1_000,
                        "cacheWriteInputTokens": 0,
                        "outputTokens": 19,
                        "reasoningOutputTokens": 4
                    },
                    "cost": {"totalCostUsd": 0.014}
                },
                "thread": {
                    "tokens": {
                        "inputTokens": 76_000,
                        "cachedInputTokens": 3_000,
                        "cacheWriteInputTokens": 0,
                        "outputTokens": 1000,
                        "reasoningOutputTokens": 100,
                        "totalTokens": 77_000
                    },
                    "cost": {"totalCostUsd": 0.044}
                }
            }
        }
    });
    let normalized = turn_view(
        &Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}")),
        &source,
    )
    .unwrap_or_else(|error| panic!("turn should normalize: {error:?}"));

    assert_eq!(
        normalized.created_at.as_ref().map(Timestamp::as_str),
        Some("2026-08-27T12:00:00Z")
    );
    assert_eq!(normalized.duration_ms, Some(3200));
    assert_eq!(
        normalized
            .activity
            .unwrap_or_else(|| panic!("activity must survive"))
            .kinds,
        ["reasoning", "commandExecution"]
    );
    let usage = normalized
        .usage
        .unwrap_or_else(|| panic!("usage must survive"));
    assert_eq!(usage.input_tokens, 26_000);
    assert_eq!(usage.output_tokens, 19);
    assert_eq!(usage.total_cost_usd, Some(0.014));
    assert_eq!(usage.latest_request_tokens, 25_700);
    assert_eq!(usage.model_context_window, Some(258_400));
    assert_eq!(usage.thread_input_tokens, 76_000);
    assert_eq!(usage.thread_output_tokens, 1000);
    assert_eq!(usage.thread_total_tokens, 77_000);
    assert_eq!(usage.thread_total_cost_usd, Some(0.044));
}

#[test]
fn missing_turn_start_timestamp_remains_authoritatively_absent() {
    let normalized = turn_view(
        &Id::new("thread").unwrap_or_else(|error| panic!("valid id: {error:?}")),
        &json!({
            "id": "turn-without-time",
            "status": "completed",
            "startedAt": null,
            "completedAt": null,
            "items": []
        }),
    )
    .unwrap_or_else(|error| panic!("turn without a source timestamp must normalize: {error:?}"));

    assert_eq!(normalized.created_at, None);
}

#[test]
fn resource_attachments_keep_their_identity_and_readable_source() {
    let normalized = attachments(&json!({
        "attachments": [
            {
                "key": "path:/tmp/report one.md",
                "name": "report one.md",
                "kind": "file",
                "path": "/tmp/report one.md"
            },
            {
                "key": "url:https://example.com/video.mp4",
                "name": "video.mp4",
                "kind": "file",
                "url": "https://example.com/video.mp4"
            }
        ]
    }))
    .unwrap_or_else(|error| panic!("attachments should normalize: {error:?}"));

    assert_eq!(normalized.len(), 2);
    assert_eq!(normalized[0].id.as_str(), "path:/tmp/report one.md");
    assert_eq!(
        normalized[0].download_url.as_deref(),
        Some("/v2/files/preview?path=%2Ftmp%2Freport%20one%2Emd")
    );
    assert_eq!(
        normalized[1].download_url.as_deref(),
        Some("https://example.com/video.mp4")
    );
}

#[test]
fn account_weekly_limit_survives_v2_normalization() {
    let result = json!({
        "activeProfileId": "profile-1",
        "allExhausted": false,
        "profiles": [{
            "id": "profile-1",
            "email": "person@example.com",
            "planType": "pro",
            "enabled": true,
            "priority": 0,
            "active": true,
            "exhaustedUntil": null,
            "exhaustedIndefinitely": false,
            "rateLimits": {
                "rateLimits": {
                    "primary": {"usedPercent": 10, "windowDurationMins": 300, "resetsAt": 1_788_000_000},
                    "secondary": {"usedPercent": 13, "windowDurationMins": 10_080, "resetsAt": 1_789_000_000}
                },
                "rateLimitsByLimitId": null
            },
            "rateLimitsUpdatedAt": 1_787_000_000,
            "rateLimitsError": null
        }]
    });
    let (active, profiles, exhausted) =
        accounts(&result).unwrap_or_else(|error| panic!("accounts should normalize: {error:?}"));
    assert_eq!(active.as_ref().map(Id::as_str), Some("profile-1"));
    assert!(!exhausted);
    let profile = profiles
        .first()
        .unwrap_or_else(|| panic!("profile should normalize"));
    assert_eq!(profile.plan.as_deref(), Some("pro"));
    assert_eq!(
        profile
            .rate_limits_updated_at
            .as_ref()
            .map(Timestamp::as_str),
        Some("2026-08-17T20:53:20Z")
    );
    let weekly = profile
        .weekly_limit
        .as_ref()
        .unwrap_or_else(|| panic!("weekly limit should normalize"));
    assert!((weekly.remaining_percent - 87.0).abs() < f64::EPSILON);
    assert_eq!(
        weekly.resets_at.as_ref().map(Timestamp::as_str),
        Some("2026-09-10T00:26:40Z")
    );
}

#[test]
fn source_error_preserves_bounded_safe_code_and_message() {
    let Err(error) = rpc_result(&json!({
        "error": {
            "code": -32602,
            "message": "invalid params",
            "data": {"debug": "structured detail is intentionally private"}
        }
    })) else {
        panic!("source error must fail");
    };

    assert_eq!(error.message, "App Server error -32602: invalid params");
    assert!(!error.message.contains("structured detail"));
    assert_eq!(error.for_wire().message, error.message);
}

#[test]
fn source_error_redacts_sensitive_message_and_structured_data_but_keeps_safe_code() {
    let secret = "PRIVATE_SENTINEL_/home/user/token";
    let Err(error) = rpc_result(&json!({
        "error": {"code": -32000, "message": secret, "data": {"credential": secret}}
    })) else {
        panic!("source error must fail");
    };
    let encoded = serde_json::to_string(&error.for_wire())
        .unwrap_or_else(|failure| panic!("error must serialize: {failure}"));
    assert!(!encoded.contains(secret));
    assert!(!encoded.contains("credential"));
    assert!(encoded.contains("App Server error -32000"));
    assert!(encoded.len() <= 256);
}
