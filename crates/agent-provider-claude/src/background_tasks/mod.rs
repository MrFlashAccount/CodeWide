//! Background task output (`thread.backgroundTask.read`,
//! `threads.backgroundTaskOutput`): one page of what a background task the
//! thread started writes, while it runs and after.
//!
//! - `task_id.rs` — the task id's shape (letters and digits only), so an id
//!   can never name another file;
//! - `facts.rs` — whether the thread's own items launched or were reported
//!   the task, and its status;
//! - `output_file.rs` — where Claude writes the output and the checked,
//!   bounded read of one page;
//! - `page.rs` — which bytes of a read window are the page (UTF-8
//!   boundaries);
//! - `read.rs` — the answer to one read: status and page, or the typed
//!   error (`-32074`).
//!
//! The caller never names a path: the provider reads only
//! `<the thread's session's tasks directory>/<task id>.output` of a task
//! the thread's own transcript launched or reported.

mod facts;
mod output_file;
mod page;
mod read;
mod task_id;

pub use facts::{LiveTaskState, TaskFacts};
pub use output_file::process_temp_root;
pub use read::{TaskRead, answer};
pub use task_id::BackgroundTaskId;
