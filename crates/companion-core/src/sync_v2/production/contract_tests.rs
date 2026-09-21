//! Focused proof that production mappings match the generated App Server contract.

use super::super::{
    contract,
    domain::{
        ApprovalDecision, ApprovalPolicy, Effort, ElicitationDefault, ElicitationField,
        ElicitationFieldType, ElicitationOption, ElicitationValue, GranularApprovalConfig,
        NetworkAccess, NetworkPolicyAmendment, NetworkPolicyRuleAction, PendingRequest,
        Personality, Sandbox, ThreadGoalStatus, ThreadGoalUpdate, ThreadSettings,
    },
    normalize,
    protocol::{
        Command, QuestionAnswer, RequestResolution, ReviewDelivery, ReviewTarget, ReviewTargetKind,
        ThreadUpdate,
    },
    scalar::Id,
};
use super::helpers::{
    approval_policy_source, effort_source, pending_request, resolution_result, review_capabilities,
    review_target_source, sandbox_policy_source, sandbox_source, thread_fork_params,
    thread_rollback_params, thread_section_move_params, thread_settings_update_params,
    thread_start_params, thread_update_rpc, turn_start_params, turn_steer_params,
};
use serde_json::json;

use super::{
    CommandDispatchError, command_rpc_result, command_transport_error, response_transport_error,
};
use crate::upstream::UpstreamError;

fn id(value: &str) -> Id {
    Id::new(value).unwrap_or_else(|error| panic!("invalid test id: {error}"))
}

fn settings() -> ThreadSettings {
    ThreadSettings {
        model: Some("gpt-5.6-sol".to_owned()),
        effort: Some(Effort::Ultra),
        approval_policy: ApprovalPolicy::OnRequest,
        sandbox: Sandbox::WorkspaceWrite,
        personality: Some(Personality::Pragmatic),
    }
}

#[test]
fn thread_and_turn_start_use_distinct_generated_contract_fields() {
    let settings = settings();
    assert_eq!(
        thread_start_params(Some("/workspace"), &settings),
        json!({
            "cwd": "/workspace",
            "model": "gpt-5.6-sol",
            "approvalPolicy": "on-request",
            "sandbox": "workspace-write",
            "personality": "pragmatic",
        })
    );
    let params = turn_start_params(
        &id("thread"),
        vec![json!({"type": "text", "text": "hi"})],
        Some(&settings),
    );
    assert_eq!(params.pointer("/effort"), Some(&json!("ultra")));
    assert_eq!(
        params.pointer("/sandboxPolicy"),
        Some(&json!({
            "type": "workspaceWrite",
            "writableRoots": [],
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false,
        }))
    );
    assert!(params.get("reasoningEffort").is_none());
    assert!(params.get("sandbox").is_none());
}

#[test]
fn fork_steer_rollback_section_and_settings_match_generated_wire_names() {
    assert_eq!(
        thread_fork_params(&id("thread"), Some(&id("turn"))),
        json!({
            "threadId": "thread",
            "lastTurnId": "turn",
            "beforeTurnId": null,
            "excludeTurns": true,
        })
    );
    assert_eq!(
        turn_steer_params(&id("thread"), &id("turn"), vec![]),
        json!({"threadId": "thread", "expectedTurnId": "turn", "input": []})
    );
    assert_eq!(
        thread_rollback_params(&id("thread"), 3),
        json!({"threadId": "thread", "numTurns": 3})
    );
    assert_eq!(
        thread_section_move_params(&id("thread"), Some(&id("section")), Some(&id("before"))),
        json!({"threadId": "thread", "sectionId": "section", "beforeThreadId": "before"})
    );
    let settings = thread_settings_update_params(&id("thread"), &settings());
    assert_eq!(settings.pointer("/effort"), Some(&json!("ultra")));
    assert!(settings.get("reasoningEffort").is_none());
    assert!(settings.get("sandbox").is_none());
    let (method, params) = thread_update_rpc(
        &id("thread"),
        ThreadUpdate::Title {
            title: Some("Renamed".to_owned()),
        },
    );
    assert_eq!(method, "thread/name/set");
    assert_eq!(params, json!({"threadId": "thread", "name": "Renamed"}));
}

#[test]
fn granular_approval_and_sandbox_modes_preserve_generated_shapes() {
    assert_eq!(
        approval_policy_source(ApprovalPolicy::Granular(GranularApprovalConfig {
            sandbox_approval: true,
            rules: false,
            skill_approval: true,
            request_permissions: false,
            mcp_elicitations: true,
        })),
        json!({
            "granular": {
                "sandbox_approval": true,
                "rules": false,
                "skill_approval": true,
                "request_permissions": false,
                "mcp_elicitations": true,
            }
        })
    );
    assert_eq!(
        sandbox_policy_source(Sandbox::ReadOnly),
        json!({"type": "readOnly", "networkAccess": false})
    );
    assert_eq!(
        sandbox_policy_source(Sandbox::Unrestricted),
        json!({"type": "dangerFullAccess"})
    );
    assert_eq!(effort_source(Some(Effort::None)), Some("none"));
    assert_eq!(effort_source(Some(Effort::Minimal)), Some("minimal"));
    assert_eq!(effort_source(Some(Effort::Max)), Some("max"));
    assert_eq!(effort_source(Some(Effort::Ultra)), Some("ultra"));
}

#[test]
fn external_sandbox_preserves_network_access_without_policy_coercion() {
    for (network_access, expected) in [
        (NetworkAccess::Restricted, "restricted"),
        (NetworkAccess::Enabled, "enabled"),
    ] {
        let settings = normalize::thread_settings(&json!({
            "model": null,
            "reasoningEffort": null,
            "approvalPolicy": "never",
            "sandboxPolicy": {
                "type": "externalSandbox",
                "networkAccess": expected,
            },
            "personality": null,
        }))
        .unwrap_or_else(|error| panic!("external sandbox mapping failed: {error:?}"));
        assert_eq!(
            settings.sandbox,
            Sandbox::ExternalSandbox { network_access }
        );
        assert_eq!(sandbox_source(settings.sandbox), None);
        assert_eq!(
            sandbox_policy_source(settings.sandbox),
            json!({"type": "externalSandbox", "networkAccess": expected})
        );
        assert_eq!(
            serde_json::to_value(settings.sandbox)
                .unwrap_or_else(|error| panic!("sandbox serialization failed: {error}")),
            json!({"type": "externalSandbox", "networkAccess": expected})
        );
    }
}

#[test]
fn goal_update_uses_flat_app_server_parameters() {
    let (method, params) = thread_update_rpc(
        &id("thread"),
        ThreadUpdate::Goal {
            goal: Some(ThreadGoalUpdate {
                objective: "ship it".to_owned(),
                status: ThreadGoalStatus::Active,
                token_budget: Some(42),
            }),
        },
    );

    assert_eq!(method, "thread/goal/set");
    assert_eq!(
        params,
        json!({
            "threadId": "thread",
            "objective": "ship it",
            "status": "active",
            "tokenBudget": 42,
        })
    );
    assert!(params.get("goal").is_none());
}

#[test]
fn review_mapping_uses_source_discriminator_and_history_capability() {
    assert_eq!(
        review_target_source(ReviewTarget::Commit {
            sha: "abc123".to_owned(),
            title: Some("Fix".to_owned()),
        }),
        json!({"type": "commit", "sha": "abc123", "title": "Fix"})
    );
    assert_eq!(
        review_capabilities(false).deliveries,
        vec![ReviewDelivery::Inline]
    );
    let detached = review_capabilities(true);
    assert_eq!(
        detached.target_kinds,
        vec![
            ReviewTargetKind::UncommittedChanges,
            ReviewTargetKind::BaseBranch,
            ReviewTargetKind::Commit,
            ReviewTargetKind::Custom,
        ]
    );
    assert_eq!(
        detached.deliveries,
        vec![ReviewDelivery::Inline, ReviewDelivery::Detached]
    );
}

#[test]
fn user_input_request_and_resolution_preserve_typed_fields() {
    let request = pending_request(
        &json!({
            "id": 7,
            "method": "item/tool/requestUserInput",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "item",
                "questions": [{
                    "id": "question",
                    "header": "Target",
                    "question": "Which target?",
                    "isOther": true,
                    "isSecret": false,
                    "options": [{"label": "Prod", "description": "Production"}]
                }]
            }
        }),
        9,
    )
    .unwrap_or_else(|error| panic!("request mapping failed: {error:?}"));
    let PendingRequest::UserInput { questions, .. } = &request else {
        panic!("wrong pending request kind");
    };
    assert_eq!(questions[0].question, "Which target?");
    assert!(questions[0].is_other);
    assert!(!questions[0].is_secret);
    assert_eq!(
        questions[0]
            .options
            .as_ref()
            .map(|options| options[0].label.as_str()),
        Some("Prod")
    );

    let result = resolution_result(
        &request,
        RequestResolution::UserInput {
            answers: vec![QuestionAnswer {
                question_id: id("question"),
                answers: vec!["Prod".to_owned()],
            }],
        },
    )
    .unwrap_or_else(|error| panic!("resolution mapping failed: {error:?}"));
    assert_eq!(
        result,
        json!({"answers": {"question": {"answers": ["Prod"]}}})
    );
}

#[test]
fn resolution_kind_must_match_the_pending_request() {
    let request = pending_request(
        &json!({
            "id": "approval",
            "method": "item/commandExecution/requestApproval",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "item",
                "command": null,
                "cwd": null,
                "reason": null,
                "networkApprovalContext": null,
                "availableDecisions": ["accept", "decline"]
            }
        }),
        1,
    )
    .unwrap_or_else(|error| panic!("request mapping failed: {error:?}"));

    assert!(
        resolution_result(
            &request,
            RequestResolution::UserInput {
                answers: Vec::new(),
            },
        )
        .is_err()
    );
    assert!(
        resolution_result(
            &request,
            RequestResolution::CommandApproval {
                decision: ApprovalDecision::AcceptForSession,
            },
        )
        .is_err(),
        "a decision that was not offered must not reach the App Server"
    );
}

#[test]
fn command_approval_uses_documented_structured_fallbacks() {
    let exec_request = pending_request(
        &json!({
            "id": "exec-approval",
            "method": "item/commandExecution/requestApproval",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "item",
                "command": "cargo test",
                "cwd": "/workspace",
                "reason": null,
                "networkApprovalContext": null,
                "additionalPermissions": null,
                "proposedExecpolicyAmendment": ["cargo", "test"],
                "proposedNetworkPolicyAmendments": null,
                "availableDecisions": null
            }
        }),
        1,
    )
    .unwrap_or_else(|error| panic!("request mapping failed: {error:?}"));
    let PendingRequest::CommandApproval {
        available_decisions,
        ..
    } = &exec_request
    else {
        panic!("wrong pending request kind");
    };
    assert_eq!(
        available_decisions,
        &vec![
            ApprovalDecision::Accept,
            ApprovalDecision::AcceptWithExecpolicyAmendment {
                execpolicy_amendment: vec!["cargo".to_owned(), "test".to_owned()],
            },
            ApprovalDecision::Cancel,
        ]
    );
    assert_eq!(
        resolution_result(
            &exec_request,
            RequestResolution::CommandApproval {
                decision: available_decisions[1].clone(),
            },
        )
        .unwrap_or_else(|error| panic!("resolution mapping failed: {error:?}")),
        json!({
            "decision": {
                "acceptWithExecpolicyAmendment": {
                    "execpolicy_amendment": ["cargo", "test"]
                }
            }
        })
    );

    let network_request = pending_request(
        &json!({
            "id": "network-approval",
            "method": "item/commandExecution/requestApproval",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "itemId": "item",
                "command": "curl",
                "cwd": "/workspace",
                "reason": "network",
                "networkApprovalContext": {},
                "proposedExecpolicyAmendment": null,
                "proposedNetworkPolicyAmendments": [
                    {"action": "deny", "host": "deny.example"},
                    {"action": "allow", "host": "allow.example"}
                ],
                "availableDecisions": null
            }
        }),
        1,
    )
    .unwrap_or_else(|error| panic!("request mapping failed: {error:?}"));
    let PendingRequest::CommandApproval {
        available_decisions,
        ..
    } = network_request
    else {
        panic!("wrong pending request kind");
    };
    assert_eq!(
        available_decisions,
        vec![
            ApprovalDecision::Accept,
            ApprovalDecision::AcceptForSession,
            ApprovalDecision::ApplyNetworkPolicyAmendment {
                network_policy_amendment: NetworkPolicyAmendment {
                    action: NetworkPolicyRuleAction::Allow,
                    host: "allow.example".to_owned(),
                },
            },
            ApprovalDecision::Cancel,
        ]
    );
}

#[test]
fn command_approval_rejects_invalid_or_empty_explicit_decisions() {
    let request = |available_decisions| {
        pending_request(
            &json!({
                "id": "approval",
                "method": "item/commandExecution/requestApproval",
                "params": {
                    "threadId": "thread",
                    "turnId": "turn",
                    "itemId": "item",
                    "command": null,
                    "cwd": null,
                    "reason": null,
                    "networkApprovalContext": null,
                    "availableDecisions": available_decisions
                }
            }),
            1,
        )
    };
    assert!(request(json!([])).is_err());
    assert!(request(json!(["accept", "futureDecision"])).is_err());
    assert!(request(json!(["accept", "accept"])).is_err());
}

#[test]
fn request_resolution_is_an_exact_durable_command_dto() {
    let command = Command::RequestResolve {
        request_id: id("approval"),
        generation: crate::sync_v2::scalar::U64::new(9),
        resolution: RequestResolution::CommandApproval {
            decision: ApprovalDecision::ApplyNetworkPolicyAmendment {
                network_policy_amendment: NetworkPolicyAmendment {
                    action: NetworkPolicyRuleAction::Allow,
                    host: "api.example".to_owned(),
                },
            },
        },
    };
    assert_eq!(
        serde_json::to_value(command)
            .unwrap_or_else(|error| panic!("request resolution serialization failed: {error}")),
        json!({
            "kind": "request.resolve",
            "requestId": "approval",
            "generation": "9",
            "resolution": {
                "kind": "commandApproval",
                "decision": {
                    "applyNetworkPolicyAmendment": {
                        "network_policy_amendment": {
                            "action": "allow",
                            "host": "api.example"
                        }
                    }
                }
            }
        })
    );
}

#[test]
fn elicitation_forms_preserve_defaults_labeled_choices_arrays_and_optionality() {
    let request = pending_request(
        &json!({
            "id": "elicitation",
            "method": "mcpServer/elicitation/request",
            "params": {
                "threadId": "thread",
                "turnId": "turn",
                "serverName": "Example MCP",
                "mode": "form",
                "message": "Configure the tool",
                "requestedSchema": {
                    "type": "object",
                    "required": ["environment", "replicas"],
                    "properties": {
                        "environment": {
                            "type": "string",
                            "title": "Environment",
                            "enum": ["dev", "prod"],
                            "enumNames": ["Development", "Production"],
                            "default": "prod"
                        },
                        "region": {
                            "type": "string",
                            "oneOf": [
                                {"const": "eu", "title": "Europe"},
                                {"const": "us", "title": "United States"}
                            ]
                        },
                        "replicas": {"type": "integer", "default": 2},
                        "enabled": {"type": "boolean", "default": false},
                        "tags": {
                            "type": "array",
                            "default": ["stable"],
                            "items": {
                                "anyOf": [
                                    {"const": "stable", "title": "Stable"},
                                    {"const": "edge", "title": "Edge"}
                                ]
                            }
                        },
                        "note": {"type": "string"},
                        "nullable": {"type": "string", "default": null}
                    }
                },
                "_meta": null
            }
        }),
        17,
    )
    .unwrap_or_else(|error| panic!("elicitation request must normalize: {error:?}"));
    let PendingRequest::Elicitation { fields, .. } = &request else {
        panic!("expected elicitation request")
    };
    assert_elicitation_fields(fields);

    let encoded = serde_json::to_value(&request)
        .unwrap_or_else(|error| panic!("elicitation serialization failed: {error}"));
    assert!(contract::valid_definition("pendingRequest", &encoded));
    let decoded: PendingRequest = serde_json::from_value(encoded)
        .unwrap_or_else(|error| panic!("elicitation deserialization failed: {error}"));
    assert_eq!(decoded, request);
}

fn assert_elicitation_fields(fields: &[ElicitationField]) {
    let field = |field_id: &str| {
        fields
            .iter()
            .find(|field| field.id.as_str() == field_id)
            .unwrap_or_else(|| panic!("missing field {field_id}"))
    };

    assert!(field("environment").required);
    assert_eq!(
        field("environment").field_type,
        ElicitationFieldType::Select
    );
    assert_eq!(
        field("environment").options,
        Some(vec![
            ElicitationOption {
                value: "dev".to_owned(),
                label: "Development".to_owned(),
            },
            ElicitationOption {
                value: "prod".to_owned(),
                label: "Production".to_owned(),
            },
        ])
    );
    assert_eq!(
        field("environment").default_value,
        ElicitationDefault::Value {
            value: ElicitationValue::String("prod".to_owned())
        }
    );
    assert_eq!(
        field("region").options,
        Some(vec![
            ElicitationOption {
                value: "eu".to_owned(),
                label: "Europe".to_owned(),
            },
            ElicitationOption {
                value: "us".to_owned(),
                label: "United States".to_owned(),
            },
        ])
    );
    assert_eq!(field("tags").field_type, ElicitationFieldType::Array);
    assert_eq!(
        field("tags").default_value,
        ElicitationDefault::Value {
            value: ElicitationValue::StringArray(vec!["stable".to_owned()])
        }
    );
    assert_eq!(
        field("enabled").default_value,
        ElicitationDefault::Value {
            value: ElicitationValue::Boolean(false)
        }
    );
    assert!(!field("note").required);
    assert_eq!(field("note").default_value, ElicitationDefault::Unset);
    assert_eq!(
        field("nullable").default_value,
        ElicitationDefault::Value {
            value: ElicitationValue::Null
        }
    );
}

#[test]
fn command_rpc_classification_separates_rejection_from_ambiguous_delivery() {
    let explicit_error = command_rpc_result(&json!({
        "id": "request",
        "error": {"code": -32602, "message": "bad params"}
    }));
    assert!(matches!(
        explicit_error,
        Err(CommandDispatchError::Failed(_))
    ));

    let missing_result = command_rpc_result(&json!({"id": "request"}));
    assert!(matches!(
        missing_result,
        Err(CommandDispatchError::Indeterminate(_))
    ));
    assert!(matches!(
        command_transport_error(&UpstreamError::Backpressure),
        CommandDispatchError::Failed(_)
    ));
    assert!(matches!(
        command_transport_error(&UpstreamError::Disconnected),
        CommandDispatchError::Indeterminate(_)
    ));
    assert!(matches!(
        command_transport_error(&UpstreamError::Protocol("invalid request".into())),
        CommandDispatchError::Failed(_)
    ));
    assert!(matches!(
        response_transport_error(&UpstreamError::Protocol("invalid response".into())),
        CommandDispatchError::Failed(_)
    ));
    assert!(matches!(
        response_transport_error(&UpstreamError::Disconnected),
        CommandDispatchError::Indeterminate(_)
    ));
}
