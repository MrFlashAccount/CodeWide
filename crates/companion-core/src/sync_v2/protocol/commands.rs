//! Closed command and interactive command payloads for Sync V2.

use serde::{Deserialize, Serialize};

use super::required_option;
use crate::sync_v2::{
    domain::{ApprovalDecision, InputBlock, PermissionProfile, ThreadGoalUpdate, ThreadSettings},
    scalar::{Id, U64},
};

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum Command {
    #[serde(rename = "thread.create")]
    ThreadCreate {
        workspace: String,
        #[serde(deserialize_with = "required_option")]
        title: Option<String>,
        settings: ThreadSettings,
    },
    #[serde(rename = "thread.fork", rename_all = "camelCase")]
    ThreadFork {
        thread_id: Id,
        #[serde(deserialize_with = "required_option")]
        through_turn_id: Option<Id>,
    },
    #[serde(rename = "thread.update", rename_all = "camelCase")]
    ThreadUpdate { thread_id: Id, change: ThreadUpdate },
    #[serde(rename = "thread.delete", rename_all = "camelCase")]
    ThreadDelete { thread_id: Id },
    #[serde(rename = "thread.markRead", rename_all = "camelCase")]
    ThreadMarkRead {
        thread_id: Id,
        through_activity_marker: String,
    },
    #[serde(rename = "turn.submit", rename_all = "camelCase")]
    TurnSubmit {
        #[serde(deserialize_with = "required_option")]
        thread_id: Option<Id>,
        #[serde(deserialize_with = "required_option")]
        workspace: Option<String>,
        input: Vec<InputBlock>,
        intent: TurnIntent,
        #[serde(deserialize_with = "required_option")]
        settings: Option<ThreadSettings>,
    },
    #[serde(rename = "turn.steer", rename_all = "camelCase")]
    TurnSteer {
        thread_id: Id,
        turn_id: Id,
        input: Vec<InputBlock>,
    },
    #[serde(rename = "review.start", rename_all = "camelCase")]
    ReviewStart {
        thread_id: Id,
        target: ReviewTarget,
        #[serde(deserialize_with = "required_option")]
        delivery: Option<ReviewDelivery>,
    },
    #[serde(rename = "turn.interrupt", rename_all = "camelCase")]
    TurnInterrupt { thread_id: Id, turn_id: Id },
    #[serde(rename = "thread.compact", rename_all = "camelCase")]
    ThreadCompact { thread_id: Id },
    #[serde(rename = "thread.rollback", rename_all = "camelCase")]
    ThreadRollback {
        thread_id: Id,
        #[serde(deserialize_with = "required_option")]
        through_turn_id: Option<Id>,
        drop_following_turns: bool,
    },
    #[serde(rename = "project.add")]
    ProjectAdd {
        path: String,
        #[serde(deserialize_with = "required_option")]
        name: Option<String>,
        pinned: bool,
    },
    #[serde(rename = "workspace.create", rename_all = "camelCase")]
    WorkspaceCreate {
        provider: Id,
        parent_path: String,
        name: String,
    },
    #[serde(rename = "queue.mutate")]
    QueueMutate { mutation: QueueMutation },
    #[serde(rename = "account.update")]
    AccountUpdate { change: AccountChange },
    #[serde(rename = "account.login.start")]
    AccountLoginStart,
    #[serde(rename = "account.login.cancel", rename_all = "camelCase")]
    AccountLoginCancel { login_id: Id },
    #[serde(rename = "process.terminate", rename_all = "camelCase")]
    ProcessTerminate { thread_id: Id, process_id: Id },
    #[serde(rename = "request.resolve", rename_all = "camelCase")]
    RequestResolve {
        request_id: Id,
        generation: U64,
        resolution: RequestResolution,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ReviewTarget {
    UncommittedChanges,
    BaseBranch {
        branch: String,
    },
    Commit {
        sha: String,
        #[serde(deserialize_with = "required_option")]
        title: Option<String>,
    },
    Custom {
        instructions: String,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewDelivery {
    Inline,
    Detached,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ThreadUpdate {
    Title {
        #[serde(deserialize_with = "required_option")]
        title: Option<String>,
    },
    Archive {
        archived: bool,
    },
    Goal {
        #[serde(deserialize_with = "required_option")]
        goal: Option<ThreadGoalUpdate>,
    },
    Settings {
        settings: ThreadSettings,
    },
    Section {
        #[serde(deserialize_with = "required_option")]
        section_id: Option<Id>,
        #[serde(deserialize_with = "required_option")]
        position: Option<U64>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnIntent {
    Chat,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum QueueMutation {
    Put {
        thread_id: Id,
        input: Vec<InputBlock>,
    },
    Edit {
        item_id: Id,
        expected_revision: String,
        editable_input: Vec<EditableInputBlock>,
    },
    Cancel {
        item_id: Id,
        expected_revision: String,
    },
    Move {
        item_id: Id,
        expected_revision: String,
        #[serde(deserialize_with = "required_option")]
        before_item_id: Option<Id>,
    },
    Retry {
        item_id: Id,
        expected_revision: String,
    },
    Steer {
        item_id: Id,
        turn_id: Id,
        expected_revision: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum EditableInputBlock {
    Text { text: String },
    Attachment { attachment_id: Id },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AccountChange {
    Activate {
        profile_id: Id,
    },
    Configure {
        profile_id: Id,
        enabled: bool,
        priority: i64,
    },
    Remove {
        profile_id: Id,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum RequestResolution {
    CommandApproval {
        decision: ApprovalDecision,
    },
    FileChangeApproval {
        decision: ApprovalDecision,
    },
    PermissionApproval {
        permissions: PermissionProfile,
        scope: PermissionGrantScope,
        strict_auto_review: bool,
    },
    UserInput {
        answers: Vec<QuestionAnswer>,
    },
    Elicitation {
        action: ElicitationAction,
        #[serde(deserialize_with = "required_option")]
        content_json: Option<String>,
        #[serde(deserialize_with = "required_option")]
        metadata_json: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PermissionGrantScope {
    Turn,
    Session,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ElicitationAction {
    Accept,
    Decline,
    Cancel,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuestionAnswer {
    pub question_id: Id,
    pub answers: Vec<String>,
}
