//! Durable Sync V2 command admission and terminal receipt ledger.

use std::{path::Path, sync::Arc};

use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};

use super::{
    auth_context::AuthenticatedContextKey,
    canonical,
    protocol::{Command, CommandResult, OperationReceipt, OperationTerminal, V2Error},
    scalar::{OperationId, ScalarError, Timestamp},
};

const OPERATIONS: TableDefinition<&str, &[u8]> = TableDefinition::new("sync_v2_operations");
const METADATA: TableDefinition<&str, &str> = TableDefinition::new("sync_v2_metadata");
const INSTALLATION_IDENTITY_KEY: &str = "companion_tls_pin_sha256";
const CONTEXT_PURGE_PREFIX: &str = "context_purge_pending:";
const TERMINAL_PAYLOAD_RETENTION: Duration = Duration::days(30);

#[derive(Clone)]
pub struct OperationLedger {
    database: Arc<Database>,
    retention_changed: Arc<tokio::sync::Notify>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct OperationRecord {
    context_key: String,
    operation_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    command_kind: Option<String>,
    accepted_at: Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    terminal_at: Option<Timestamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payload_expired_at: Option<Timestamp>,
    state: OperationState,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum OperationState {
    Admitted,
    Completed { result: CommandResult },
    Failed { error: V2Error },
    Indeterminate { error: V2Error },
    Tombstone { terminal: TombstoneTerminal },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
enum TombstoneTerminal {
    Completed,
    Failed,
    Indeterminate,
}

#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug)]
pub enum Admission {
    New {
        accepted_at: Timestamp,
    },
    Admitted {
        accepted_at: Timestamp,
    },
    Completed {
        accepted_at: Timestamp,
        result: CommandResult,
    },
    Failed {
        accepted_at: Timestamp,
        error: V2Error,
    },
    Indeterminate {
        accepted_at: Timestamp,
        error: V2Error,
    },
    Expired,
    Conflict,
}

#[derive(Debug, thiserror::Error)]
pub enum LedgerError {
    #[error("operation ledger database failed: {0}")]
    Database(#[from] redb::DatabaseError),
    #[error("operation ledger transaction failed: {0}")]
    Transaction(#[from] redb::TransactionError),
    #[error("operation ledger table failed: {0}")]
    Table(#[from] redb::TableError),
    #[error("operation ledger storage failed: {0}")]
    Storage(#[from] redb::StorageError),
    #[error("operation ledger commit failed: {0}")]
    Commit(#[from] redb::CommitError),
    #[error("operation ledger record is corrupt: {0}")]
    Corrupt(#[from] serde_json::Error),
    #[error("operation ledger timestamp is corrupt: {0}")]
    InvalidTimestamp(#[from] time::error::Parse),
    #[error("operation ledger timestamp formatting failed: {0}")]
    TimestampFormat(#[from] time::error::Format),
    #[error("operation ledger timestamp invariant failed: {0}")]
    TimestampInvariant(#[from] ScalarError),
}

impl OperationLedger {
    #[cfg(test)]
    pub fn open(path: impl AsRef<Path>) -> Result<Self, LedgerError> {
        Self::open_for_installation(path, "test-installation")
    }

    pub fn open_for_installation(
        path: impl AsRef<Path>,
        installation_identity: &str,
    ) -> Result<Self, LedgerError> {
        let database = Database::create(path)?;
        let write = database.begin_write()?;
        {
            let mut operations = write.open_table(OPERATIONS)?;
            let mut metadata = write.open_table(METADATA)?;
            let retained_identity = metadata
                .get(INSTALLATION_IDENTITY_KEY)?
                .map(|value| value.value().to_owned());
            if retained_identity.as_deref() == Some(installation_identity) {
                let now = Timestamp::now();
                let recovered = operations
                    .iter()?
                    .filter_map(Result::ok)
                    .filter_map(|(key, value)| {
                        let mut record =
                            serde_json::from_slice::<OperationRecord>(value.value()).ok()?;
                        if !matches!(record.state, OperationState::Admitted) {
                            return None;
                        }
                        record.terminal_at = Some(now.clone());
                        record.state = OperationState::Indeterminate {
                            error: V2Error::operation_indeterminate(
                                "command admission survived restart without a proven terminal outcome",
                            ),
                        };
                        Some((key.value().to_owned(), record))
                    })
                    .collect::<Vec<_>>();
                for (key, record) in recovered {
                    let encoded = serde_json::to_vec(&record)?;
                    operations.insert(key.as_str(), encoded.as_slice())?;
                }
            } else {
                let keys = operations
                    .iter()?
                    .filter_map(Result::ok)
                    .map(|(key, _)| key.value().to_owned())
                    .collect::<Vec<_>>();
                for key in keys {
                    operations.remove(key.as_str())?;
                }
                let purge_markers = metadata
                    .iter()?
                    .filter_map(Result::ok)
                    .map(|(key, _)| key.value().to_owned())
                    .filter(|key| key.starts_with(CONTEXT_PURGE_PREFIX))
                    .collect::<Vec<_>>();
                for key in purge_markers {
                    metadata.remove(key.as_str())?;
                }
                metadata.insert(INSTALLATION_IDENTITY_KEY, installation_identity)?;
            }
        }
        write.commit()?;
        let ledger = Self {
            database: Arc::new(database),
            retention_changed: Arc::new(tokio::sync::Notify::new()),
        };
        ledger.expire_old_terminal_payloads()?;
        Ok(ledger)
    }

    pub fn admit(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        command: &Command,
    ) -> Result<Admission, LedgerError> {
        let fingerprint = command_fingerprint(command)?;
        let key = ledger_key(context_key, operation_id);
        let write = self.database.begin_write()?;
        let admission = {
            let mut table = write.open_table(OPERATIONS)?;
            let record = table
                .get(key.as_str())?
                .map(|value| serde_json::from_slice::<OperationRecord>(value.value()))
                .transpose()?;
            if let Some(record) = record {
                match record.state {
                    OperationState::Tombstone { .. } => Admission::Expired,
                    _ if record.fingerprint.as_deref() != Some(fingerprint.as_str())
                        || record.command_kind.as_deref() != Some(command.kind()) =>
                    {
                        Admission::Conflict
                    }
                    _ => match record.state {
                        OperationState::Admitted => Admission::Admitted {
                            accepted_at: record.accepted_at,
                        },
                        OperationState::Completed { result } => Admission::Completed {
                            accepted_at: record.accepted_at,
                            result,
                        },
                        OperationState::Failed { error } => Admission::Failed {
                            accepted_at: record.accepted_at,
                            error,
                        },
                        OperationState::Indeterminate { error } => Admission::Indeterminate {
                            accepted_at: record.accepted_at,
                            error,
                        },
                        OperationState::Tombstone { .. } => unreachable!(),
                    },
                }
            } else {
                let accepted_at = Timestamp::now();
                let record = OperationRecord {
                    context_key: context_key.as_str().into(),
                    operation_id: operation_id.as_str().into(),
                    fingerprint: Some(fingerprint),
                    command_kind: Some(command.kind().into()),
                    accepted_at: accepted_at.clone(),
                    terminal_at: None,
                    payload_expired_at: None,
                    state: OperationState::Admitted,
                };
                let encoded = serde_json::to_vec(&record)?;
                table.insert(key.as_str(), encoded.as_slice())?;
                Admission::New { accepted_at }
            }
        };
        write.commit()?;
        Ok(admission)
    }

    pub fn receipt(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
    ) -> Result<Option<OperationReceipt>, LedgerError> {
        let key = ledger_key(context_key, operation_id);
        let read = self.database.begin_read()?;
        let table = read.open_table(OPERATIONS)?;
        let record = table
            .get(key.as_str())?
            .map(|value| serde_json::from_slice::<OperationRecord>(value.value()))
            .transpose()?;
        Ok(record.map(|record| match record.state {
            OperationState::Admitted => OperationReceipt::Admitted {
                accepted_at: record.accepted_at,
            },
            OperationState::Completed { result } => OperationReceipt::Completed {
                accepted_at: record.accepted_at,
                result,
            },
            OperationState::Failed { error } => OperationReceipt::Failed {
                accepted_at: record.accepted_at,
                error,
            },
            OperationState::Indeterminate { error } => OperationReceipt::Indeterminate {
                accepted_at: record.accepted_at,
                error,
            },
            OperationState::Tombstone { terminal } => OperationReceipt::Expired {
                accepted_at: record.accepted_at,
                terminal: match terminal {
                    TombstoneTerminal::Completed => OperationTerminal::Completed,
                    TombstoneTerminal::Failed => OperationTerminal::Failed,
                    TombstoneTerminal::Indeterminate => OperationTerminal::Indeterminate,
                },
            },
        }))
    }

    pub fn complete(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        result: CommandResult,
    ) -> Result<(), LedgerError> {
        self.finish(
            context_key,
            operation_id,
            OperationState::Completed { result },
        )
    }

    pub fn fail(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        error: V2Error,
    ) -> Result<(), LedgerError> {
        self.finish(context_key, operation_id, OperationState::Failed { error })
    }

    pub fn indeterminate(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        error: V2Error,
    ) -> Result<(), LedgerError> {
        self.finish(
            context_key,
            operation_id,
            OperationState::Indeterminate { error },
        )
    }

    #[cfg(test)]
    fn backdate(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        accepted_at: Timestamp,
    ) -> Result<(), LedgerError> {
        let key = ledger_key(context_key, operation_id);
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(OPERATIONS)?;
            let Some(encoded) = table.get(key.as_str())?.map(|value| value.value().to_vec()) else {
                return Ok(());
            };
            let mut record: OperationRecord = serde_json::from_slice(&encoded)?;
            if record.terminal_at.is_some() {
                record.terminal_at = Some(accepted_at);
            } else {
                record.accepted_at = accepted_at;
            }
            let encoded = serde_json::to_vec(&record)?;
            table.insert(key.as_str(), encoded.as_slice())?;
        }
        write.commit()?;
        Ok(())
    }

    pub fn purge_context(&self, context_key: &AuthenticatedContextKey) -> Result<(), LedgerError> {
        let prefix = format!("{}#", context_key.as_str());
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(OPERATIONS)?;
            let keys = table
                .iter()?
                .filter_map(Result::ok)
                .map(|(key, _)| key.value().to_owned())
                .filter(|key| key.starts_with(&prefix))
                .collect::<Vec<_>>();
            for key in keys {
                table.remove(key.as_str())?;
            }
        }
        write.commit()?;
        Ok(())
    }

    pub fn begin_context_purge(
        &self,
        context_key: &AuthenticatedContextKey,
    ) -> Result<(), LedgerError> {
        let key = context_purge_key(context_key);
        let write = self.database.begin_write()?;
        {
            let mut metadata = write.open_table(METADATA)?;
            metadata.insert(key.as_str(), "1")?;
        }
        write.commit()?;
        Ok(())
    }

    pub fn finish_context_purge(
        &self,
        context_key: &AuthenticatedContextKey,
    ) -> Result<(), LedgerError> {
        let key = context_purge_key(context_key);
        let write = self.database.begin_write()?;
        {
            let mut metadata = write.open_table(METADATA)?;
            metadata.remove(key.as_str())?;
        }
        write.commit()?;
        Ok(())
    }

    pub fn context_purge_pending(
        &self,
        context_key: &AuthenticatedContextKey,
    ) -> Result<bool, LedgerError> {
        let key = context_purge_key(context_key);
        let read = self.database.begin_read()?;
        let metadata = read.open_table(METADATA)?;
        Ok(metadata.get(key.as_str())?.is_some())
    }

    pub fn start_retention_task(&self) {
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        let database = Arc::downgrade(&self.database);
        let retention_changed = Arc::downgrade(&self.retention_changed);
        std::mem::drop(runtime.spawn(async move {
            loop {
                let (Some(database), Some(retention_changed)) =
                    (database.upgrade(), retention_changed.upgrade())
                else {
                    return;
                };
                let cleanup = OperationLedger {
                    database,
                    retention_changed: retention_changed.clone(),
                };
                let next = match tokio::task::spawn_blocking(move || {
                    cleanup.expire_old_terminal_payloads()?;
                    cleanup.next_payload_expiration()
                })
                .await
                {
                    Ok(Ok(next)) => next,
                    Ok(Err(_)) => {
                        tracing::warn!("Sync V2 retention sweep failed");
                        Some(OffsetDateTime::now_utc() + Duration::hours(1))
                    }
                    Err(_) => return,
                };
                match next {
                    Some(deadline) => {
                        let wait = deadline - OffsetDateTime::now_utc();
                        let wait = std::time::Duration::try_from(wait)
                            .unwrap_or(std::time::Duration::ZERO);
                        tokio::select! {
                            () = tokio::time::sleep(wait) => {}
                            () = retention_changed.notified() => {}
                        }
                    }
                    None => retention_changed.notified().await,
                }
            }
        }));
    }

    fn expire_old_terminal_payloads(&self) -> Result<(), LedgerError> {
        let cutoff = OffsetDateTime::now_utc() - TERMINAL_PAYLOAD_RETENTION;
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(OPERATIONS)?;
            let mut expired = Vec::new();
            for entry in table.iter()? {
                let (key, value) = entry?;
                let mut record: OperationRecord = serde_json::from_slice(value.value())?;
                let terminal_at = record
                    .terminal_at
                    .as_ref()
                    .unwrap_or(&record.accepted_at)
                    .clone();
                let terminal_time = OffsetDateTime::parse(terminal_at.as_str(), &Rfc3339)?;
                let terminal = match record.state {
                    OperationState::Completed { .. } if terminal_time <= cutoff => {
                        TombstoneTerminal::Completed
                    }
                    OperationState::Failed { .. } if terminal_time <= cutoff => {
                        TombstoneTerminal::Failed
                    }
                    OperationState::Indeterminate { .. } if terminal_time <= cutoff => {
                        TombstoneTerminal::Indeterminate
                    }
                    _ => continue,
                };
                record.fingerprint = None;
                record.command_kind = None;
                record.terminal_at = Some(terminal_at);
                record.payload_expired_at = Some(Timestamp::new(
                    (terminal_time + TERMINAL_PAYLOAD_RETENTION).format(&Rfc3339)?,
                )?);
                record.state = OperationState::Tombstone { terminal };
                expired.push((key.value().to_owned(), serde_json::to_vec(&record)?));
            }
            for (key, encoded) in &expired {
                table.insert(key.as_str(), encoded.as_slice())?;
            }
        }
        write.commit()?;
        Ok(())
    }

    fn next_payload_expiration(&self) -> Result<Option<OffsetDateTime>, LedgerError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(OPERATIONS)?;
        let mut next = None;
        for entry in table.iter()? {
            let (_, value) = entry?;
            let record: OperationRecord = serde_json::from_slice(value.value())?;
            if matches!(
                record.state,
                OperationState::Admitted | OperationState::Tombstone { .. }
            ) {
                continue;
            }
            let terminal_at = record.terminal_at.as_ref().unwrap_or(&record.accepted_at);
            let expires_at =
                OffsetDateTime::parse(terminal_at.as_str(), &Rfc3339)? + TERMINAL_PAYLOAD_RETENTION;
            next = Some(next.map_or(expires_at, |current: OffsetDateTime| {
                current.min(expires_at)
            }));
        }
        Ok(next)
    }

    fn finish(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        state: OperationState,
    ) -> Result<(), LedgerError> {
        let key = ledger_key(context_key, operation_id);
        let write = self.database.begin_write()?;
        {
            let mut table = write.open_table(OPERATIONS)?;
            let record = table
                .get(key.as_str())?
                .map(|value| serde_json::from_slice::<OperationRecord>(value.value()))
                .transpose()?;
            if let Some(mut record) = record {
                record.terminal_at = Some(Timestamp::now());
                record.payload_expired_at = None;
                record.state = state;
                let encoded = serde_json::to_vec(&record)?;
                table.insert(key.as_str(), encoded.as_slice())?;
            }
        }
        write.commit()?;
        self.retention_changed.notify_one();
        Ok(())
    }
}

fn command_fingerprint(command: &Command) -> Result<String, serde_json::Error> {
    Ok(blake3::hash(&canonical::to_vec(command)?)
        .to_hex()
        .to_string())
}

fn ledger_key(context_key: &AuthenticatedContextKey, operation_id: &OperationId) -> String {
    format!("{}#{}", context_key.as_str(), operation_id.as_str())
}

fn context_purge_key(context_key: &AuthenticatedContextKey) -> String {
    format!("{CONTEXT_PURGE_PREFIX}{}", context_key.as_str())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use crate::sync_v2::{
        domain::{ApprovalPolicy, Sandbox, ThreadSettings},
        protocol::{Command, CommandResult, OperationReceipt},
        scalar::Id,
    };

    fn context(device: &str) -> AuthenticatedContextKey {
        AuthenticatedContextKey::derive(&crate::auth::AuthorizationContext::Session {
            device_id: device.into(),
            scopes: vec!["threads.read".into()],
            expires_at: u64::MAX,
        })
        .unwrap()
    }

    #[test]
    fn ledger_replays_and_rejects_conflicting_payloads() {
        let directory = tempfile::tempdir().unwrap();
        let ledger = OperationLedger::open(directory.path().join("ledger.redb")).unwrap();
        let id = OperationId::new("stable-operation").unwrap();
        let context = context("device-a");
        let command = Command::ThreadCreate {
            workspace: "/tmp/work".into(),
            title: None,
            settings: ThreadSettings {
                model: None,
                effort: None,
                approval_policy: ApprovalPolicy::Never,
                sandbox: Sandbox::WorkspaceWrite,
            },
        };
        assert!(matches!(
            ledger.admit(&context, &id, &command).unwrap(),
            Admission::New { .. }
        ));
        assert!(matches!(
            ledger.admit(&context, &id, &command).unwrap(),
            Admission::Admitted { .. }
        ));
        let conflicting = Command::ThreadCreate {
            workspace: "/tmp/other".into(),
            title: None,
            settings: ThreadSettings {
                model: None,
                effort: None,
                approval_policy: ApprovalPolicy::Never,
                sandbox: Sandbox::WorkspaceWrite,
            },
        };
        assert!(matches!(
            ledger.admit(&context, &id, &conflicting).unwrap(),
            Admission::Conflict
        ));
        ledger
            .backdate(
                &context,
                &id,
                Timestamp::new("2020-01-01T00:00:00Z").unwrap(),
            )
            .unwrap();
        ledger.expire_old_terminal_payloads().unwrap();
        assert!(matches!(
            ledger.admit(&context, &id, &command).unwrap(),
            Admission::Admitted { .. }
        ));
    }

    #[test]
    fn admitted_receipt_is_queryable_and_becomes_indeterminate_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.redb");
        let id = OperationId::new("orphaned-operation").unwrap();
        let context = context("device-a");
        let command = Command::ThreadDelete {
            thread_id: Id::new("thread").unwrap(),
        };
        {
            let ledger = OperationLedger::open(&path).unwrap();
            assert!(matches!(
                ledger.admit(&context, &id, &command).unwrap(),
                Admission::New { .. }
            ));
            assert!(matches!(
                ledger.receipt(&context, &id).unwrap(),
                Some(OperationReceipt::Admitted { .. })
            ));
        }

        let reopened = OperationLedger::open(&path).unwrap();
        assert!(matches!(
            reopened.receipt(&context, &id).unwrap(),
            Some(OperationReceipt::Indeterminate { .. })
        ));
        assert!(matches!(
            reopened.admit(&context, &id, &command).unwrap(),
            Admission::Indeterminate { .. }
        ));
    }

    #[test]
    fn terminal_receipt_survives_restart_and_old_payload_becomes_tombstone() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.redb");
        let retained_id = OperationId::new("retained-operation").unwrap();
        let expired_id = OperationId::new("expired-operation").unwrap();
        let thread_id = Id::new("thread").unwrap();
        let command = Command::ThreadDelete {
            thread_id: thread_id.clone(),
        };
        let context_a = context("device-a");
        let result = CommandResult::ThreadDelete {
            thread_id: thread_id.clone(),
        };
        {
            let ledger = OperationLedger::open(&path).unwrap();
            assert!(matches!(
                ledger.admit(&context_a, &retained_id, &command).unwrap(),
                Admission::New { .. }
            ));
            ledger
                .complete(&context_a, &retained_id, result.clone())
                .unwrap();
            assert!(matches!(
                ledger.admit(&context_a, &expired_id, &command).unwrap(),
                Admission::New { .. }
            ));
            ledger
                .complete(&context_a, &expired_id, result.clone())
                .unwrap();
            ledger
                .backdate(
                    &context_a,
                    &expired_id,
                    Timestamp::new("2020-01-01T00:00:00Z").unwrap(),
                )
                .unwrap();
        }
        let reopened = OperationLedger::open(&path).unwrap();
        let read = reopened.database.begin_read().unwrap();
        let table = read.open_table(OPERATIONS).unwrap();
        let key = ledger_key(&context_a, &expired_id);
        let tombstone: serde_json::Value =
            serde_json::from_slice(table.get(key.as_str()).unwrap().unwrap().value()).unwrap();
        assert!(tombstone.get("fingerprint").is_none());
        assert!(tombstone.get("commandKind").is_none());
        assert_eq!(tombstone["payloadExpiredAt"], "2020-01-31T00:00:00Z");
        assert_eq!(tombstone["state"]["kind"], "tombstone");
        drop(table);
        drop(read);
        assert!(matches!(
            reopened.admit(&context_a, &retained_id, &command).unwrap(),
            Admission::Completed { result: replayed, .. } if replayed == result
        ));
        assert!(matches!(
            reopened.admit(&context_a, &expired_id, &command).unwrap(),
            Admission::Expired
        ));
        let other = context("device-b");
        assert!(matches!(
            reopened.admit(&other, &retained_id, &command).unwrap(),
            Admission::New { .. }
        ));
        reopened.purge_context(&context_a).unwrap();
        assert!(matches!(
            reopened.admit(&context_a, &retained_id, &command).unwrap(),
            Admission::New { .. }
        ));
    }

    #[test]
    fn installation_identity_rotation_atomically_purges_receipts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.redb");
        let operation_id = OperationId::new("rotated-operation").unwrap();
        let context = context("device-a");
        let command = Command::ThreadDelete {
            thread_id: Id::new("thread").unwrap(),
        };
        {
            let ledger = OperationLedger::open_for_installation(&path, "pin-a").unwrap();
            assert!(matches!(
                ledger.admit(&context, &operation_id, &command).unwrap(),
                Admission::New { .. }
            ));
        }

        let rotated = OperationLedger::open_for_installation(&path, "pin-b").unwrap();
        assert!(matches!(
            rotated.admit(&context, &operation_id, &command).unwrap(),
            Admission::New { .. }
        ));
    }
}
