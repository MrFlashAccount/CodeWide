//! Permission rules of a live session (`host/src/permissions/approvals.ts`
//! and `profiles.ts`): honest approval and user-input requests for a
//! `can_use_tool` prompt, the user's response mapped to a
//! [`PermissionDecision`], and what each permission profile lets the user
//! be asked about.
//!
//! Fail-closed: a `decline`, `cancel`, `{type: "error"}` or mismatched
//! response always denies, and an unknown profile id runs as `:read-only`.
//! `acceptForSession` only ever grants for the session: Claude's suggested
//! updates are rewritten to the `session` destination, so no settings file
//! is written. Pure; no I/O apart from path arithmetic.

use std::path::{Component, Path};

use agent_core::model::{
    ApprovalDecision, ApprovalKind, ItemId, PermissionProfileEntry, QuestionOption, RuntimeRequest,
    RuntimeResponse, UserInputQuestion,
};
use serde_json::{Map, Value};

use crate::cli::command::{PermissionProfile, READ_ONLY_TOOLS};
use crate::cli::protocol::{PermissionDecision, session_scoped};
use crate::transcript::json::{JsonRecord, arr_of, record, str_of};
use crate::transcript::tools::{ToolContext, split_mcp_tool_name};

/// The tool result of a declined approval.
pub const DECLINE_MESSAGE: &str = "User declined tool execution.";
/// The tool result of a cancelled approval; the turn ends with it.
pub const CANCEL_MESSAGE: &str = "User cancelled the turn.";
/// The tool result of `ExitPlanMode`, which is always denied so the plan
/// waits for the user's reply.
pub const EXIT_PLAN_MESSAGE: &str =
    "The user will review this plan. Stop here and wait for their reply.";
/// The start of every [`read_only_deny_message`].
pub const READ_ONLY_DENY_PREFIX: &str = "The read-only permission profile does not allow";

/// The tool result of a tool the read-only profile refuses.
#[must_use]
pub fn read_only_deny_message(tool: &str) -> String {
    format!("{READ_ONLY_DENY_PREFIX} {tool}.")
}

/// The error of a session setting naming no built-in profile.
#[must_use]
pub fn unsupported_profile_message(id: &str) -> String {
    format!("Unsupported permission profile for Claude: {id}")
}

/// The profile a live session runs under: an unknown id runs as
/// `:read-only` (fail closed).
#[must_use]
pub fn profile_of(id: &str) -> PermissionProfile {
    PermissionProfile::parse(id).unwrap_or(PermissionProfile::ReadOnly)
}

/// Whether a live process can move from one profile to the other by
/// changing its permission mode alone. Both must load the same settings,
/// MCP servers and tools, so `:read-only` (its own tool set, no settings, no
/// MCP) changes only when the process reopens at a turn boundary.
#[must_use]
pub fn switches_live(from: PermissionProfile, to: PermissionProfile) -> bool {
    from != PermissionProfile::ReadOnly && to != PermissionProfile::ReadOnly
}

/// Whether the user may be asked about this tool under the profile;
/// `:read-only` refuses everything but its read tools.
#[must_use]
pub fn profile_allows_tool(profile: PermissionProfile, tool_name: &str) -> bool {
    profile != PermissionProfile::ReadOnly || READ_ONLY_TOOLS.contains(&tool_name)
}

/// The profiles Claude offers (`permissionProfile.list`). The alias
/// `:danger-full-access` is accepted but not listed.
#[must_use]
pub fn permission_profiles() -> Vec<PermissionProfileEntry> {
    [
        (
            ":read-only",
            "Read only",
            "Reads files. Every other tool is refused.",
        ),
        (
            ":workspace",
            "Workspace",
            "Edits files in the workspace. Other actions ask for approval unless your Claude settings allow them.",
        ),
        (
            ":full-access",
            "Full access",
            "Runs every tool without asking.",
        ),
    ]
    .into_iter()
    .map(|(id, display_name, description)| PermissionProfileEntry {
        id: id.to_owned(),
        display_name: display_name.to_owned(),
        description: description.to_owned(),
    })
    .collect()
}

/// What kind of approval a tool asks for.
#[must_use]
pub fn approval_kind(tool_name: &str) -> ApprovalKind {
    match tool_name {
        "Bash" => ApprovalKind::Command,
        "Edit" | "MultiEdit" | "NotebookEdit" | "Write" => ApprovalKind::FileChange,
        _ => ApprovalKind::Tool,
    }
}

/// `path` relative to `cwd` when it lies inside it, else as given. Lexical:
/// a path that leaves `cwd` through `..` is shown whole.
fn display_path<'a>(path: &'a str, cwd: &str) -> &'a str {
    let absolute = Path::new(path);
    if !absolute.is_absolute() {
        return path;
    }
    absolute
        .strip_prefix(cwd)
        .ok()
        .filter(|inside| {
            inside
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
        })
        .and_then(Path::to_str)
        .filter(|inside| !inside.is_empty() && !inside.starts_with(".."))
        .unwrap_or(path)
}

fn path_title(verb: &str, input: &JsonRecord, cwd: &str) -> String {
    match str_of(input, "file_path").or_else(|| str_of(input, "notebook_path")) {
        Some(path) => format!("{verb} {}", display_path(path, cwd)),
        None => format!("{verb} a file"),
    }
}

/// One line describing exactly what the user approves.
#[must_use]
pub fn approval_title(tool_name: &str, input: &JsonRecord, context: &ToolContext<'_>) -> String {
    let or = |name: &str, fallback: &'static str| str_of(input, name).unwrap_or(fallback);
    match tool_name {
        "Bash" => format!("Run {}", or("command", "a command")),
        "Edit" | "MultiEdit" | "NotebookEdit" => path_title("Edit", input, context.cwd),
        "Read" => path_title("Read", input, context.cwd),
        "Write" => path_title("Write", input, context.cwd),
        "WebFetch" => format!("Fetch {}", or("url", "a web page")),
        "WebSearch" => format!("Search the web for {}", or("query", "a query")),
        _ => match split_mcp_tool_name(tool_name, context.mcp_servers) {
            Some((server, tool)) => format!("Use {server} · {tool}"),
            None => format!("Use {tool_name}"),
        },
    }
}

/// The tool call an approval is asked for.
pub struct ApprovalSubject<'a> {
    /// The tool use id, branded at the `can_use_tool` boundary.
    pub item_id: ItemId,
    pub tool_name: &'a str,
    pub input: &'a JsonRecord,
    /// Claude's reason for asking, shown as detail.
    pub detail: Option<&'a str>,
    /// The session's working directory and connected MCP servers.
    pub context: ToolContext<'a>,
}

/// The approval request the user answers for a tool call.
#[must_use]
pub fn approval_request(subject: ApprovalSubject<'_>) -> RuntimeRequest {
    let kind = approval_kind(subject.tool_name);
    let title = approval_title(subject.tool_name, subject.input, &subject.context);
    let (command, cwd) = match kind {
        ApprovalKind::Command => (
            str_of(subject.input, "command").map(str::to_owned),
            Some(subject.context.cwd.to_owned()),
        ),
        ApprovalKind::FileChange => (None, Some(subject.context.cwd.to_owned())),
        ApprovalKind::Tool => (Some(title.clone()), None),
    };
    RuntimeRequest::Approval {
        kind,
        item_id: subject.item_id,
        title,
        detail: subject.detail.map(str::to_owned),
        command,
        cwd,
        decisions: vec![
            ApprovalDecision::Accept,
            ApprovalDecision::AcceptForSession,
            ApprovalDecision::Decline,
            ApprovalDecision::Cancel,
        ],
    }
}

/// Runs the tool with this input, this time only.
#[must_use]
pub fn allow_once(input: JsonRecord) -> PermissionDecision {
    PermissionDecision::Allow {
        input,
        updated_permissions: None,
    }
}

/// Refuses the tool; the turn goes on.
#[must_use]
pub fn decline() -> PermissionDecision {
    deny(DECLINE_MESSAGE)
}

/// Refuses the tool and ends the turn (cancelled, or no turn to ask in).
#[must_use]
pub fn cancelled_decision() -> PermissionDecision {
    PermissionDecision::Deny {
        message: CANCEL_MESSAGE.to_owned(),
        interrupt: true,
    }
}

/// Refuses the tool with `message`; the turn goes on.
#[must_use]
pub fn deny(message: &str) -> PermissionDecision {
    PermissionDecision::Deny {
        message: message.to_owned(),
        interrupt: false,
    }
}

/// The user's response to an approval. `acceptForSession` also allows
/// Claude's `suggestions` for the rest of the session (never in a settings
/// file); anything but an approval response declines.
#[must_use]
pub fn approval_decision(
    response: &RuntimeResponse,
    input: JsonRecord,
    suggestions: &[Value],
) -> PermissionDecision {
    let RuntimeResponse::Approval { decision } = response else {
        return decline();
    };
    match decision {
        ApprovalDecision::Accept => allow_once(input),
        ApprovalDecision::AcceptForSession => PermissionDecision::Allow {
            input,
            updated_permissions: Some(session_scoped(suggestions)),
        },
        ApprovalDecision::Decline => decline(),
        ApprovalDecision::Cancel => cancelled_decision(),
    }
}

/// `AskUserQuestion`'s questions, with ids `q<index>` (the index in the
/// tool input, so ids stay stable when a malformed question is skipped).
#[must_use]
pub fn user_input_questions(input: &JsonRecord) -> Vec<UserInputQuestion> {
    arr_of(input, "questions")
        .iter()
        .enumerate()
        .filter_map(|(index, question)| {
            let question = record(question)?;
            let text = |record: &JsonRecord, name: &str| {
                str_of(record, name).unwrap_or_default().to_owned()
            };
            Some(UserInputQuestion {
                id: format!("q{index}"),
                header: text(question, "header"),
                question: text(question, "question"),
                options: arr_of(question, "options")
                    .iter()
                    .filter_map(record)
                    .map(|option| QuestionOption {
                        label: text(option, "label"),
                        description: text(option, "description"),
                    })
                    .collect(),
                multi_select: question.get("multiSelect") == Some(&Value::Bool(true)),
                secret: false,
                allow_other: true,
            })
        })
        .collect()
}

/// One answer as Claude receives it. For a multi-select question, a
/// comma-separated answer whose parts all match option labels
/// (case-insensitively) becomes those labels; anything else is passed
/// through as the user's own text.
#[must_use]
pub fn normalize_answer(question: &UserInputQuestion, answers: &[String]) -> String {
    let joined = answers.join(", ");
    if !question.multi_select {
        return joined;
    }
    let mut labels = Vec::new();
    for part in joined.split(',').map(str::trim) {
        if part.is_empty() {
            continue;
        }
        let part = part.to_lowercase();
        let Some(option) = question
            .options
            .iter()
            .find(|option| option.label.to_lowercase() == part)
        else {
            return joined;
        };
        labels.push(option.label.as_str());
    }
    if labels.is_empty() {
        joined
    } else {
        labels.join(", ")
    }
}

/// The user's response to `AskUserQuestion`: the tool runs once with
/// `answers` (question text → answer) added to its input. Anything but a
/// user-input response declines.
#[must_use]
pub fn user_input_decision(
    response: &RuntimeResponse,
    mut input: JsonRecord,
    questions: &[UserInputQuestion],
) -> PermissionDecision {
    let RuntimeResponse::UserInput { answers } = response else {
        return decline();
    };
    let answers: Map<String, Value> = questions
        .iter()
        .filter_map(|question| {
            let answer = answers.get(&question.id)?;
            Some((
                question.question.clone(),
                Value::String(normalize_answer(question, &answer.answers)),
            ))
        })
        .collect();
    input.insert("answers".to_owned(), Value::Object(answers));
    allow_once(input)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use agent_core::model::UserInputAnswer;
    use serde_json::json;

    use super::*;

    fn object(value: Value) -> JsonRecord {
        match value {
            Value::Object(record) => record,
            _ => unreachable!(),
        }
    }

    fn approval(decision: ApprovalDecision) -> RuntimeResponse {
        RuntimeResponse::Approval { decision }
    }

    fn context(mcp_servers: &[String]) -> ToolContext<'_> {
        ToolContext {
            cwd: "/w",
            mcp_servers,
        }
    }

    fn denied(decision: &PermissionDecision) -> Option<(&str, bool)> {
        match decision {
            PermissionDecision::Deny { message, interrupt } => Some((message, *interrupt)),
            PermissionDecision::Allow { .. } => None,
        }
    }

    #[test]
    fn profiles_fix_the_security_relevant_options() {
        let read_only = PermissionProfile::ReadOnly.options();
        assert_eq!(read_only.permission_mode, "default");
        assert!(read_only.setting_sources.is_empty());
        assert!(read_only.strict_mcp_config);
        assert_eq!(read_only.tools, Some(&["Read", "Glob", "Grep", "LS"][..]));
        assert!(!read_only.allow_dangerously_skip_permissions);
        let workspace = PermissionProfile::Workspace.options();
        assert_eq!(workspace.permission_mode, "acceptEdits");
        assert_eq!(workspace.setting_sources, ["user", "project", "local"]);
        assert!(!workspace.allow_dangerously_skip_permissions);
        for id in [":full-access", ":danger-full-access"] {
            let full = profile_of(id).options();
            assert_eq!(full.permission_mode, "bypassPermissions");
            assert!(full.allow_dangerously_skip_permissions);
        }
    }

    #[test]
    fn an_unknown_profile_runs_read_only_and_read_only_switches_only_at_a_reopen() {
        assert_eq!(profile_of(":custom"), PermissionProfile::ReadOnly);
        assert!(PermissionProfile::parse(":custom").is_none());
        assert!(
            unsupported_profile_message(":custom").ends_with(":custom"),
            "names the id"
        );
        let (read_only, workspace, full) = (
            PermissionProfile::ReadOnly,
            PermissionProfile::Workspace,
            PermissionProfile::FullAccess,
        );
        assert!(switches_live(workspace, full));
        assert!(switches_live(full, workspace));
        assert!(!switches_live(read_only, workspace));
        assert!(!switches_live(full, read_only));
        assert!(profile_allows_tool(read_only, "Grep"));
        assert!(!profile_allows_tool(read_only, "Bash"));
        assert!(!profile_allows_tool(read_only, "mcp__notes__write_note"));
        assert!(profile_allows_tool(workspace, "Bash"));
        assert_eq!(
            read_only_deny_message("Bash"),
            "The read-only permission profile does not allow Bash."
        );
        let listed: Vec<String> = permission_profiles()
            .into_iter()
            .map(|entry| entry.id)
            .collect();
        assert_eq!(listed, [":read-only", ":workspace", ":full-access"]);
    }

    #[test]
    fn maps_accept_accept_for_session_decline_and_cancel() {
        let input = object(json!({"command": "pnpm test"}));
        let suggestions = [
            json!({"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "pnpm test"}], "behavior": "allow", "destination": "localSettings"}),
            json!({"type": "setMode", "mode": "acceptEdits", "destination": "session"}),
        ];
        assert_eq!(
            approval_decision(
                &approval(ApprovalDecision::Accept),
                input.clone(),
                &suggestions
            ),
            PermissionDecision::Allow {
                input: input.clone(),
                updated_permissions: None,
            }
        );
        let PermissionDecision::Allow {
            input: allowed,
            updated_permissions: Some(updates),
        } = approval_decision(
            &approval(ApprovalDecision::AcceptForSession),
            input.clone(),
            &suggestions,
        )
        else {
            unreachable!("acceptForSession allows for the session");
        };
        assert_eq!(allowed, input);
        // Never writes a settings file.
        assert!(
            updates
                .iter()
                .all(|update| update["destination"] == "session")
        );
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0]["rules"][0]["ruleContent"], "pnpm test");
        assert_eq!(
            denied(&approval_decision(
                &approval(ApprovalDecision::Decline),
                input.clone(),
                &suggestions
            )),
            Some((DECLINE_MESSAGE, false))
        );
        assert_eq!(
            denied(&approval_decision(
                &approval(ApprovalDecision::Cancel),
                input,
                &suggestions
            )),
            Some((CANCEL_MESSAGE, true))
        );
    }

    #[test]
    fn never_allows_on_an_error_or_a_mismatched_response() {
        let input = object(json!({"command": "ls"}));
        let error = RuntimeResponse::Error {
            message: "x".into(),
        };
        assert_eq!(
            denied(&approval_decision(&error, input.clone(), &[])),
            Some((DECLINE_MESSAGE, false))
        );
        let user_input = RuntimeResponse::UserInput {
            answers: BTreeMap::new(),
        };
        assert!(denied(&approval_decision(&user_input, input.clone(), &[])).is_some());
        assert!(
            denied(&user_input_decision(
                &approval(ApprovalDecision::Accept),
                input,
                &[]
            ))
            .is_some()
        );
    }

    #[test]
    fn titles_describe_what_is_approved() {
        let none: [String; 0] = [];
        let title =
            |tool: &str, input: Value| approval_title(tool, &object(input), &context(&none));
        assert_eq!(title("Bash", json!({"command": "ls"})), "Run ls");
        assert_eq!(title("Bash", json!({})), "Run a command");
        assert_eq!(
            title("Edit", json!({"file_path": "/w/src/a.ts"})),
            "Edit src/a.ts"
        );
        assert_eq!(
            title("Write", json!({"file_path": "/etc/x"})),
            "Write /etc/x"
        );
        assert_eq!(
            title("Write", json!({"file_path": "/w/../etc/x"})),
            "Write /w/../etc/x"
        );
        assert_eq!(title("Read", json!({"file_path": "/w"})), "Read /w");
        assert_eq!(
            title("NotebookEdit", json!({"notebook_path": "n.ipynb"})),
            "Edit n.ipynb"
        );
        assert_eq!(
            title("WebFetch", json!({"url": "https://e.com"})),
            "Fetch https://e.com"
        );
        assert_eq!(title("Glob", json!({})), "Use Glob");
        let servers = ["notes".to_owned()];
        assert_eq!(
            approval_title(
                "mcp__notes__write_note",
                &JsonRecord::new(),
                &context(&servers)
            ),
            "Use notes · write_note"
        );
    }

    #[test]
    fn approval_requests_carry_the_command_or_the_working_directory() {
        let none: [String; 0] = [];
        let request = |tool: &str, input: &JsonRecord| {
            approval_request(ApprovalSubject {
                item_id: ItemId::from_static("toolu_1"),
                tool_name: tool,
                input,
                detail: Some("asks"),
                context: context(&none),
            })
        };
        let bash = object(json!({"command": "rm -rf build"}));
        let RuntimeRequest::Approval {
            kind,
            item_id,
            title,
            detail,
            command,
            cwd,
            decisions,
        } = request("Bash", &bash)
        else {
            unreachable!();
        };
        assert_eq!(kind, ApprovalKind::Command);
        assert_eq!(item_id.as_str(), "toolu_1");
        assert_eq!(title, "Run rm -rf build");
        assert_eq!(detail.as_deref(), Some("asks"));
        assert_eq!(command.as_deref(), Some("rm -rf build"));
        assert_eq!(cwd.as_deref(), Some("/w"));
        assert_eq!(decisions.len(), 4);
        let edit = object(json!({"file_path": "/w/a.rs"}));
        let RuntimeRequest::Approval {
            kind, command, cwd, ..
        } = request("Edit", &edit)
        else {
            unreachable!();
        };
        assert_eq!(kind, ApprovalKind::FileChange);
        assert_eq!((command, cwd.as_deref()), (None, Some("/w")));
        let RuntimeRequest::Approval {
            kind, command, cwd, ..
        } = request("WebSearch", &object(json!({"query": "rust"})))
        else {
            unreachable!();
        };
        assert_eq!(kind, ApprovalKind::Tool);
        assert_eq!(command.as_deref(), Some("Search the web for rust"));
        assert_eq!(cwd, None);
    }

    fn questions_input() -> JsonRecord {
        object(json!({"questions": [
            {"question": "Which runner?", "header": "Runner", "multiSelect": true, "options": [
                {"label": "vitest", "description": "Unit"},
                {"label": "playwright", "description": "E2E"},
            ]},
            "not a question",
            {"question": "Name?", "header": "Name", "multiSelect": false, "options": []},
        ]}))
    }

    #[test]
    fn maps_a_comma_separated_custom_answer_onto_option_labels() {
        let questions = user_input_questions(&questions_input());
        let ids: Vec<&str> = questions.iter().map(|q| q.id.as_str()).collect();
        assert_eq!(ids, ["q0", "q2"]);
        let runner = &questions[0];
        assert!(runner.multi_select && runner.allow_other && !runner.secret);
        assert_eq!(runner.options[1].description, "E2E");
        assert_eq!(
            normalize_answer(runner, &["VITEST,  Playwright".into()]),
            "vitest, playwright"
        );
        assert_eq!(
            normalize_answer(runner, &["vitest, something else".into()]),
            "vitest, something else"
        );
        assert_eq!(normalize_answer(&questions[1], &["A, B".into()]), "A, B");
    }

    #[test]
    fn answers_claude_by_question_text() {
        let input = questions_input();
        let questions = user_input_questions(&input);
        let answer = |text: &str| UserInputAnswer {
            answers: vec![text.to_owned()],
        };
        let response = RuntimeResponse::UserInput {
            answers: BTreeMap::from([
                ("q0".into(), answer("vitest")),
                ("q2".into(), answer("Ada")),
            ]),
        };
        let PermissionDecision::Allow {
            input: updated,
            updated_permissions: None,
        } = user_input_decision(&response, input, &questions)
        else {
            unreachable!("answers allow once");
        };
        assert_eq!(
            updated["answers"],
            json!({"Which runner?": "vitest", "Name?": "Ada"})
        );
        assert!(updated["questions"].is_array(), "keeps the tool input");
    }
}
