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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    required_scope: Option<String>,
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
    #[error("operation ledger record has no recoverable command authority")]
    MissingAuthority,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthorizedOperationReceipt {
    pub receipt: OperationReceipt,
    pub required_scope: String,
}

impl LedgerError {
    #[must_use]
    pub(crate) const fn is_permanently_unreadable_receipt(&self) -> bool {
        matches!(
            self,
            Self::Corrupt(_)
                | Self::InvalidTimestamp(_)
                | Self::TimestampInvariant(_)
                | Self::MissingAuthority
        )
    }
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
                admission_from_record(record, &fingerprint, command.kind())
            } else {
                let accepted_at = Timestamp::now();
                let record = OperationRecord {
                    context_key: context_key.as_str().into(),
                    operation_id: operation_id.as_str().into(),
                    fingerprint: Some(fingerprint),
                    command_kind: Some(command.kind().into()),
                    required_scope: Some(
                        super::protocol::command_required_scope(command).to_owned(),
                    ),
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

    /// Reads an existing admission without creating a durable retry boundary.
    ///
    /// This lets the runtime return a retained terminal receipt before consulting
    /// source-owned authorization state that the completed command may have removed.
    pub fn retained_admission(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
        command: &Command,
    ) -> Result<Option<Admission>, LedgerError> {
        let fingerprint = command_fingerprint(command)?;
        let key = ledger_key(context_key, operation_id);
        let read = self.database.begin_read()?;
        let table = read.open_table(OPERATIONS)?;
        let record = table
            .get(key.as_str())?
            .map(|value| serde_json::from_slice::<OperationRecord>(value.value()))
            .transpose()?;
        Ok(record.map(|record| admission_from_record(record, &fingerprint, command.kind())))
    }

    #[cfg(test)]
    pub fn receipt(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
    ) -> Result<Option<OperationReceipt>, LedgerError> {
        Ok(self
            .authorized_receipt(context_key, operation_id)?
            .map(|record| record.receipt))
    }

    pub(crate) fn authorized_receipt(
        &self,
        context_key: &AuthenticatedContextKey,
        operation_id: &OperationId,
    ) -> Result<Option<AuthorizedOperationReceipt>, LedgerError> {
        let key = ledger_key(context_key, operation_id);
        let read = self.database.begin_read()?;
        let table = read.open_table(OPERATIONS)?;
        let record = table
            .get(key.as_str())?
            .map(|value| serde_json::from_slice::<OperationRecord>(value.value()))
            .transpose()?;
        let Some(record) = record else {
            return Ok(None);
        };
        let required_scope = record
            .required_scope
            .clone()
            .or_else(|| {
                record
                    .command_kind
                    .as_deref()
                    .and_then(super::protocol::command_scope_for_kind)
                    .map(str::to_owned)
            })
            .ok_or(LedgerError::MissingAuthority)?;
        let receipt = match record.state {
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
        };
        Ok(Some(AuthorizedOperationReceipt {
            receipt,
            required_scope,
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
                if record.required_scope.is_none() {
                    record.required_scope = record
                        .command_kind
                        .as_deref()
                        .and_then(super::protocol::command_scope_for_kind)
                        .map(str::to_owned);
                }
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

fn admission_from_record(
    record: OperationRecord,
    fingerprint: &str,
    command_kind: &str,
) -> Admission {
    match record.state {
        OperationState::Tombstone { .. } => Admission::Expired,
        _ if record.fingerprint.as_deref() != Some(fingerprint)
            || record.command_kind.as_deref() != Some(command_kind) =>
        {
            Admission::Conflict
        }
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
        domain::{ApprovalDecision, ApprovalPolicy, Sandbox, ThreadSettings},
        protocol::{
            Command, CommandResult, OperationReceipt, QueueMutation, RequestResolution, TurnIntent,
            V2Error,
        },
        scalar::{Id, U64},
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
                personality: None,
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
                personality: None,
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

    fn assert_recovery_authority_after_restart(
        commands: Vec<(&'static str, Command, &'static str)>,
    ) {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.redb");
        let context = context("device-a");
        {
            let ledger = OperationLedger::open(&path).unwrap();
            for (operation_id, command, _) in &commands {
                assert!(matches!(
                    ledger
                        .admit(
                            &context,
                            &OperationId::new((*operation_id).to_owned()).unwrap(),
                            command,
                        )
                        .unwrap(),
                    Admission::New { .. }
                ));
            }
        }

        let reopened = OperationLedger::open(&path).unwrap();
        for (operation_id, _, expected_scope) in commands {
            let receipt = reopened
                .authorized_receipt(
                    &context,
                    &OperationId::new(operation_id.to_owned()).unwrap(),
                )
                .unwrap()
                .unwrap();
            assert_eq!(receipt.required_scope, expected_scope);
            assert!(matches!(
                receipt.receipt,
                OperationReceipt::Indeterminate { .. }
            ));
        }
    }

    #[test]
    fn approval_and_turn_recovery_authority_survives_restart() {
        let thread_id = Id::new("thread").unwrap();
        assert_recovery_authority_after_restart(vec![
            (
                "approval",
                Command::RequestResolve {
                    request_id: Id::new("request").unwrap(),
                    generation: U64::new(1),
                    resolution: RequestResolution::CommandApproval {
                        decision: ApprovalDecision::Decline,
                    },
                },
                "approvals.respond",
            ),
            (
                "submit",
                Command::TurnSubmit {
                    thread_id: Some(thread_id.clone()),
                    workspace: None,
                    input: Vec::new(),
                    intent: TurnIntent::Chat,
                    settings: None,
                },
                "turns.start",
            ),
            (
                "steer",
                Command::TurnSteer {
                    thread_id: thread_id.clone(),
                    turn_id: Id::new("turn").unwrap(),
                    input: Vec::new(),
                },
                "turns.steer",
            ),
        ]);
    }

    #[test]
    fn management_and_thread_recovery_authority_survives_restart() {
        let thread_id = Id::new("thread").unwrap();
        assert_recovery_authority_after_restart(vec![
            (
                "interrupt",
                Command::TurnInterrupt {
                    thread_id: thread_id.clone(),
                    turn_id: Id::new("turn").unwrap(),
                },
                "processes.manage",
            ),
            ("account", Command::AccountLoginStart, "accounts.manage"),
            (
                "project",
                Command::ProjectAdd {
                    path: "/tmp/project".into(),
                    name: None,
                    pinned: false,
                },
                "files.upload.workspace",
            ),
            (
                "thread",
                Command::ThreadDelete {
                    thread_id: thread_id.clone(),
                },
                "threads.write",
            ),
        ]);
    }

    #[test]
    fn queue_payload_recovery_authority_survives_restart() {
        let thread_id = Id::new("thread").unwrap();
        assert_recovery_authority_after_restart(vec![
            (
                "queue-put",
                Command::QueueMutate {
                    mutation: QueueMutation::Put {
                        thread_id: thread_id.clone(),
                        input: Vec::new(),
                    },
                },
                "turns.start",
            ),
            (
                "queue-steer",
                Command::QueueMutate {
                    mutation: QueueMutation::Steer {
                        item_id: Id::new("item").unwrap(),
                        turn_id: Id::new("turn").unwrap(),
                        expected_revision: "revision".into(),
                    },
                },
                "turns.steer",
            ),
        ]);
    }

    #[test]
    fn durable_request_resolution_replays_a_proven_failure_for_the_same_operation() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.redb");
        let operation_id = OperationId::new("resolve-approval").unwrap();
        let context = context("device-a");
        let command = Command::RequestResolve {
            request_id: Id::new("approval").unwrap(),
            generation: U64::new(3),
            resolution: RequestResolution::CommandApproval {
                decision: ApprovalDecision::Decline,
            },
        };
        let error = V2Error::source_unavailable("explicit App Server rejection");
        {
            let ledger = OperationLedger::open(&path).unwrap();
            assert!(matches!(
                ledger.admit(&context, &operation_id, &command).unwrap(),
                Admission::New { .. }
            ));
            ledger.fail(&context, &operation_id, error.clone()).unwrap();
        }
        let reopened = OperationLedger::open(&path).unwrap();
        assert!(matches!(
            reopened
                .admit(&context, &operation_id, &command)
                .unwrap(),
            Admission::Failed { error: retained, .. } if retained == error
        ));
    }

    #[test]
    fn ambiguous_request_resolution_is_never_redispatched_with_a_fresh_outcome() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("ledger.redb");
        let operation_id = OperationId::new("resolve-after-disconnect").unwrap();
        let context = context("device-a");
        let command = Command::RequestResolve {
            request_id: Id::new("approval").unwrap(),
            generation: U64::new(3),
            resolution: RequestResolution::CommandApproval {
                decision: ApprovalDecision::Accept,
            },
        };
        let error = V2Error::operation_indeterminate(
            "App Server response delivery outcome is unknown after disconnect",
        );
        {
            let ledger = OperationLedger::open(&path).unwrap();
            assert!(matches!(
                ledger.admit(&context, &operation_id, &command).unwrap(),
                Admission::New { .. }
            ));
            ledger
                .indeterminate(&context, &operation_id, error.clone())
                .unwrap();
        }

        let reopened = OperationLedger::open(&path).unwrap();
        assert!(matches!(
            reopened
                .admit(&context, &operation_id, &command)
                .unwrap(),
            Admission::Indeterminate { error: retained, .. } if retained == error
        ));
        let changed_resolution = Command::RequestResolve {
            request_id: Id::new("approval").unwrap(),
            generation: U64::new(3),
            resolution: RequestResolution::CommandApproval {
                decision: ApprovalDecision::Decline,
            },
        };
        assert!(matches!(
            reopened
                .admit(&context, &operation_id, &changed_resolution)
                .unwrap(),
            Admission::Conflict
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
        assert_eq!(tombstone["requiredScope"], "threads.write");
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
        assert_eq!(
            reopened
                .authorized_receipt(&context_a, &expired_id)
                .unwrap()
                .unwrap()
                .required_scope,
            "threads.write"
        );
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

    #[test]
    fn legacy_receipt_authority_is_derived_and_authorityless_rows_fail_closed() {
        let directory = tempfile::tempdir().unwrap();
        let ledger = OperationLedger::open(directory.path().join("ledger.redb")).unwrap();
        let operation_id = OperationId::new("legacy-operation").unwrap();
        let context = context("device-a");
        let command = Command::ThreadDelete {
            thread_id: Id::new("thread").unwrap(),
        };
        assert!(matches!(
            ledger.admit(&context, &operation_id, &command).unwrap(),
            Admission::New { .. }
        ));
        let key = ledger_key(&context, &operation_id);

        let write = ledger.database.begin_write().unwrap();
        {
            let mut table = write.open_table(OPERATIONS).unwrap();
            let mut value: serde_json::Value =
                serde_json::from_slice(table.get(key.as_str()).unwrap().unwrap().value()).unwrap();
            value.as_object_mut().unwrap().remove("requiredScope");
            let encoded = serde_json::to_vec(&value).unwrap();
            table.insert(key.as_str(), encoded.as_slice()).unwrap();
        }
        write.commit().unwrap();
        assert_eq!(
            ledger
                .authorized_receipt(&context, &operation_id)
                .unwrap()
                .unwrap()
                .required_scope,
            "threads.write"
        );

        let write = ledger.database.begin_write().unwrap();
        {
            let mut table = write.open_table(OPERATIONS).unwrap();
            let mut value: serde_json::Value =
                serde_json::from_slice(table.get(key.as_str()).unwrap().unwrap().value()).unwrap();
            value.as_object_mut().unwrap().remove("commandKind");
            let encoded = serde_json::to_vec(&value).unwrap();
            table.insert(key.as_str(), encoded.as_slice()).unwrap();
        }
        write.commit().unwrap();
        let error = ledger
            .authorized_receipt(&context, &operation_id)
            .unwrap_err();
        assert!(matches!(error, LedgerError::MissingAuthority));
        assert!(error.is_permanently_unreadable_receipt());
    }

    #[test]
    fn corrupt_single_receipt_is_permanently_unreadable() {
        let corrupt =
            LedgerError::Corrupt(serde_json::from_slice::<serde_json::Value>(b"{").unwrap_err());
        assert!(corrupt.is_permanently_unreadable_receipt());
    }
}
