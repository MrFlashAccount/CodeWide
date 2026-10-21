//! The answer to one `thread.backgroundTask.read`: the task must be one the
//! thread's own items launched or reported; then its status and one page of
//! its output, or the typed error a client shows. Blocking (file I/O).

use std::path::Path;

use agent_core::model::{
    BackgroundTaskReadResult, ERROR_BACKGROUND_TASK_UNAVAILABLE, MAX_BACKGROUND_TASK_PAGE_BYTES,
    RpcError, background_task_not_found_message, background_task_output_unavailable_message,
};

use super::{
    BackgroundTaskId, LiveTaskState, TaskFacts,
    output_file::{OutputRequest, read_page},
};
use crate::native::files::SessionFile;

/// Everything a read is answered from.
pub struct TaskRead<'a> {
    pub task: &'a BackgroundTaskId,
    pub facts: &'a TaskFacts,
    /// What the thread's open query knows of the task.
    pub live: Option<LiveTaskState>,
    /// The session files of the thread's chain, newest first.
    pub sessions: &'a [SessionFile],
    /// The temp root of the companion's `claude` children.
    pub temp_root: &'a Path,
    pub offset: u64,
    pub limit: u32,
}

/// The page, or `-32074` for a task the thread never launched or reported
/// and for output that is gone.
///
/// # Errors
/// `-32074 "background task not found: <id>"` or `-32074 "background task
/// output is unavailable: <id>"`.
pub fn answer(read: &TaskRead<'_>) -> Result<BackgroundTaskReadResult, RpcError> {
    let task_id = read.task.as_str();
    if !read.facts.known {
        return Err(RpcError::new(
            ERROR_BACKGROUND_TASK_UNAVAILABLE,
            background_task_not_found_message(task_id),
        ));
    }
    let page = read_page(&OutputRequest {
        task: read.task,
        sessions: read.sessions,
        temp_root: Some(read.temp_root),
        claimed_output: read.facts.claimed_output.as_deref(),
        offset: read.offset,
        limit: read.limit.clamp(1, MAX_BACKGROUND_TASK_PAGE_BYTES),
    })
    .ok_or_else(|| {
        RpcError::new(
            ERROR_BACKGROUND_TASK_UNAVAILABLE,
            background_task_output_unavailable_message(task_id),
        )
    })?;
    Ok(BackgroundTaskReadResult {
        task_id: task_id.to_owned(),
        command: read.facts.command.clone(),
        status: read.facts.status(read.live),
        text: page.text,
        next_offset: page.next_offset,
        size_bytes: page.size_bytes,
    })
}
