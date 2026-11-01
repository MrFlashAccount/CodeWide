//! Durable orchestration tables.
//!
//! Values are versioned JSON owned by `agent::orchestration::journal`. This
//! module owns only table placement and exposes the table handles required
//! for the journal's atomic transactions.

use super::StoreError;
use redb::{TableDefinition, WriteTransaction};

pub(crate) const TASKS: TableDefinition<&str, &[u8]> = TableDefinition::new("orchestration_tasks");
pub(crate) const ATTEMPTS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_task_attempts");
pub(crate) const CALLS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_tool_calls");
pub(crate) const EVENTS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_task_events");
pub(crate) const DELIVERIES: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_deliveries");
pub(crate) const WORKSPACE_CLAIMS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_workspace_claims");
pub(crate) const TASKS_BY_CHILD: TableDefinition<&str, &str> =
    TableDefinition::new("orchestration_tasks_by_child");
/// Child work requests by request id (prompt-free JSON).
pub(crate) const WORK_REQUESTS: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_work_requests");
/// Unsettled requests with a known child: key `child\0request`, value request id.
pub(crate) const OPEN_REQUESTS_BY_CHILD: TableDefinition<&str, &str> =
    TableDefinition::new("orchestration_open_requests_by_child");
/// The outbox command whose delivery receipt binds a request.
pub(crate) const REQUESTS_BY_COMMAND: TableDefinition<&str, &str> =
    TableDefinition::new("orchestration_requests_by_command");
/// Settled requests awaiting their parent handoff: key `parent\0request`.
pub(crate) const HANDOFFS_BY_PARENT: TableDefinition<&str, &str> =
    TableDefinition::new("orchestration_handoffs_by_parent");
/// Parent notice command id → the requests it carries (prompt-free JSON).
pub(crate) const NOTICES: TableDefinition<&str, &[u8]> =
    TableDefinition::new("orchestration_parent_notices");
/// Parent thread → its newest notice command id (batching).
pub(crate) const LATEST_NOTICE_BY_PARENT: TableDefinition<&str, &str> =
    TableDefinition::new("orchestration_latest_notice_by_parent");
/// Parent thread → consecutive turns started only by completion notices.
pub(crate) const PARENT_WAKES: TableDefinition<&str, u64> =
    TableDefinition::new("orchestration_parent_wakes");
/// Orchestration job markers (backfills).
pub(crate) const META: TableDefinition<&str, &[u8]> = TableDefinition::new("orchestration_meta");

pub(super) fn create(write: &WriteTransaction) -> Result<(), StoreError> {
    write.open_table(TASKS)?;
    write.open_table(ATTEMPTS)?;
    write.open_table(CALLS)?;
    write.open_table(EVENTS)?;
    write.open_table(DELIVERIES)?;
    write.open_table(WORKSPACE_CLAIMS)?;
    write.open_table(TASKS_BY_CHILD)?;
    write.open_table(WORK_REQUESTS)?;
    write.open_table(OPEN_REQUESTS_BY_CHILD)?;
    write.open_table(REQUESTS_BY_COMMAND)?;
    write.open_table(HANDOFFS_BY_PARENT)?;
    write.open_table(NOTICES)?;
    write.open_table(LATEST_NOTICE_BY_PARENT)?;
    write.open_table(PARENT_WAKES)?;
    write.open_table(META)?;
    Ok(())
}
