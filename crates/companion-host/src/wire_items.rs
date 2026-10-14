//! The companion's own client-wire item types: names its wire
//! projector emits and its activity readers recognise, defined once.

/// `type` of a background task's report on the client wire
/// (`codewideTaskNotification`): a message to the agent, not the agent's work.
pub const TASK_NOTIFICATION_ITEM_TYPE: &str = "codewideTaskNotification";
