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

pub(super) fn create(write: &WriteTransaction) -> Result<(), StoreError> {
    write.open_table(TASKS)?;
    write.open_table(ATTEMPTS)?;
    write.open_table(CALLS)?;
    write.open_table(EVENTS)?;
    write.open_table(DELIVERIES)?;
    write.open_table(WORKSPACE_CLAIMS)?;
    write.open_table(TASKS_BY_CHILD)?;
    Ok(())
}
