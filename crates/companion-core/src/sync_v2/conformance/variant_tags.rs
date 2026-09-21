//! Exhaustive tag extractors for nested Rust-owned Sync V2 variants.

use crate::sync_v2::{
    domain::{InputBlock, Item, PendingRequest, ProjectionChange},
    protocol::{AccountChange, ErrorCode, QueueMutation, RequestResolution, ThreadUpdate, V2Error},
};

pub(super) fn input_block_tag(value: &InputBlock) -> &'static str {
    match value {
        InputBlock::Text { .. } => "text",
        InputBlock::Attachment { .. } => "attachment",
        InputBlock::Skill { .. } => "skill",
    }
}

pub(super) fn item_tag(value: &Item) -> &'static str {
    match value {
        Item::UserMessage { .. } => "userMessage",
        Item::AssistantText { .. } => "assistantText",
        Item::Reasoning { .. } => "reasoning",
        Item::Command { .. } => "command",
        Item::FileChange { .. } => "fileChange",
        Item::Tool { .. } => "tool",
        Item::Plan { .. } => "plan",
        Item::Attachment { .. } => "attachment",
        Item::HookPrompt { .. } => "hookPrompt",
        Item::Collaboration { .. } => "collaboration",
        Item::SubagentActivity { .. } => "subagentActivity",
        Item::WebSearch { .. } => "webSearch",
        Item::ImageView { .. } => "imageView",
        Item::Sleep { .. } => "sleep",
        Item::ImageGeneration { .. } => "imageGeneration",
        Item::ReviewMode { .. } => "reviewMode",
        Item::ContextCompaction { .. } => "contextCompaction",
        Item::Unsupported { .. } => "unsupported",
    }
}

pub(super) fn pending_request_tag(value: &PendingRequest) -> &'static str {
    match value {
        PendingRequest::CommandApproval { .. } => "commandApproval",
        PendingRequest::FileChangeApproval { .. } => "fileChangeApproval",
        PendingRequest::PermissionApproval { .. } => "permissionApproval",
        PendingRequest::UserInput { .. } => "userInput",
        PendingRequest::Elicitation { .. } => "elicitation",
    }
}

pub(super) fn projection_change_tag(value: &ProjectionChange) -> &'static str {
    match value {
        ProjectionChange::ThreadUpserted { .. } => "threadUpserted",
        ProjectionChange::ThreadRemoved { .. } => "threadRemoved",
        ProjectionChange::CurrentThreadReplaced { .. } => "currentThreadReplaced",
        ProjectionChange::TurnUpserted { .. } => "turnUpserted",
        ProjectionChange::ItemLifecycleChanged { .. } => "itemLifecycleChanged",
        ProjectionChange::PendingRequestOpened { .. } => "pendingRequestOpened",
        ProjectionChange::PendingRequestClosed { .. } => "pendingRequestClosed",
        ProjectionChange::ResourcesChanged { .. } => "resourcesChanged",
        ProjectionChange::AgentsChanged { .. } => "agentsChanged",
        ProjectionChange::QueueChanged { .. } => "queueChanged",
        ProjectionChange::ThreadGoalChanged { .. } => "threadGoalChanged",
        ProjectionChange::SkillsChanged { .. } => "skillsChanged",
        ProjectionChange::AccountsChanged { .. } => "accountsChanged",
    }
}

pub(super) fn thread_update_tag(value: &ThreadUpdate) -> &'static str {
    match value {
        ThreadUpdate::Title { .. } => "title",
        ThreadUpdate::Archive { .. } => "archive",
        ThreadUpdate::Goal { .. } => "goal",
        ThreadUpdate::Settings { .. } => "settings",
        ThreadUpdate::Section { .. } => "section",
    }
}

pub(super) fn queue_mutation_tag(value: &QueueMutation) -> &'static str {
    match value {
        QueueMutation::Put { .. } => "put",
        QueueMutation::Edit { .. } => "edit",
        QueueMutation::Cancel { .. } => "cancel",
        QueueMutation::Move { .. } => "move",
        QueueMutation::Retry { .. } => "retry",
        QueueMutation::Steer { .. } => "steer",
    }
}

pub(super) fn account_change_tag(value: &AccountChange) -> &'static str {
    match value {
        AccountChange::Activate { .. } => "activate",
        AccountChange::Configure { .. } => "configure",
        AccountChange::Remove { .. } => "remove",
    }
}

pub(super) fn request_resolution_tag(value: &RequestResolution) -> &'static str {
    match value {
        RequestResolution::CommandApproval { .. } => "commandApproval",
        RequestResolution::FileChangeApproval { .. } => "fileChangeApproval",
        RequestResolution::PermissionApproval { .. } => "permissionApproval",
        RequestResolution::UserInput { .. } => "userInput",
        RequestResolution::Elicitation { .. } => "elicitation",
    }
}

pub(super) fn v2_error_tag(value: &V2Error) -> &'static str {
    match value.code {
        ErrorCode::InvalidRequest => "invalidRequest",
        ErrorCode::InvalidQuery => "invalidQuery",
        ErrorCode::Unauthorized => "unauthorized",
        ErrorCode::Forbidden => "forbidden",
        ErrorCode::NotFound => "notFound",
        ErrorCode::Conflict => "conflict",
        ErrorCode::SourceUnavailable => "sourceUnavailable",
        ErrorCode::RateLimited => "rateLimited",
        ErrorCode::InvalidCursor => "invalidCursor",
        ErrorCode::StaleCursor => "staleCursor",
        ErrorCode::OperationIdConflict => "operationIdConflict",
        ErrorCode::OperationExpired => "operationExpired",
        ErrorCode::OperationIndeterminate => "operationIndeterminate",
        ErrorCode::RequestExpired => "requestExpired",
        ErrorCode::GenerationChanged => "generationChanged",
        ErrorCode::UnsupportedCapability => "unsupportedCapability",
    }
}
