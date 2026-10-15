//! Lifecycle of the operation behind the `active.json` pointer as seen by
//! status.
//!
//! The pointer outlives a terminal operation so a phone that lost its
//! connection while the product restarted can still learn the outcome. That
//! retention is bounded: a terminal outcome is reported only while it is
//! recent and still describes the installed generation. Anything else is
//! hidden immediately and the pointer is removed opportunistically. In-flight
//! operations are always reported. Admission does not depend on this module:
//! it ignores terminal records through `active_operation()` regardless.

use std::{fs, io, path::Path};

use super::{OperationRecord, store};
use crate::{HostUpdateJournalV1, HostUpdatePhase};

/// How long a terminal outcome stays visible after its last journal update.
///
/// The longest automatic path from apply to a terminal phase is bounded by
/// the rollback deadline (12 minutes after acceptance), and a reconnecting
/// phone normally returns within the reconnect deadline (9 minutes). One hour
/// leaves several times that margin for a slow phone, a host reboot or a
/// delayed app launch, while still letting a stale result disappear on its own
/// the same day.
pub(super) const TERMINAL_OUTCOME_TTL_MS: u64 = 60 * 60_000;

/// Why a pointed-at operation is no longer reported and its pointer is removed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum DiscardReason {
    /// The terminal outcome is older than [`TERMINAL_OUTCOME_TTL_MS`].
    Expired,
    /// The installed generation is not the one the terminal outcome describes,
    /// for example after a manual reinstall.
    Superseded,
    /// The operation record no longer exists.
    Missing,
    /// The operation record cannot be decoded.
    Corrupt,
}

impl DiscardReason {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Expired => "expired",
            Self::Superseded => "superseded",
            Self::Missing => "missing",
            Self::Corrupt => "corrupt",
        }
    }
}

/// Decides whether status may still report `journal` for the generation whose
/// artifact digest is `installed_digest` at Unix millisecond `now`.
///
/// Relevance per terminal phase:
/// - `committed` describes the target, so it holds while the target is installed;
/// - `rolledBack` restored the pre-update generation, so it holds while that
///   generation is installed;
/// - `failed` either stopped before activation (pre-update generation still
///   installed) or failed to finish a rollback, in which case `current` may
///   still point at the target. Both generations belong to the operation, so
///   it holds while either is installed; any third generation means the host
///   was reinstalled outside the guardian.
///
/// A timestamp ahead of `now` counts as fresh; relevance still bounds it.
pub(super) fn discard_reason(
    journal: &HostUpdateJournalV1,
    installed_digest: &str,
    now: u64,
) -> Option<DiscardReason> {
    let describes_installed = match journal.phase {
        HostUpdatePhase::Accepted
        | HostUpdatePhase::Installing
        | HostUpdatePhase::TargetReady
        | HostUpdatePhase::AwaitingReconnect
        | HostUpdatePhase::RollingBack => return None,
        HostUpdatePhase::Committed => installed_digest == journal.target_digest,
        HostUpdatePhase::RolledBack => installed_digest == journal.current_digest,
        HostUpdatePhase::Failed => {
            installed_digest == journal.current_digest || installed_digest == journal.target_digest
        }
    };
    if !describes_installed {
        return Some(DiscardReason::Superseded);
    }
    (now.saturating_sub(journal.updated_at) > TERMINAL_OUTCOME_TTL_MS)
        .then_some(DiscardReason::Expired)
}

/// Reads the operation behind `active.json` that status may report. A
/// discarded pointer is hidden at once and removed when the guardian lock is
/// free; a failed removal is retried by the next status read.
///
/// # Errors
/// Returns an I/O error when the pointer or the record cannot be read for a
/// reason other than absence or corruption of the record.
pub(super) fn reported_operation(
    state_root: &Path,
    installed_digest: &str,
    now: u64,
) -> io::Result<Option<OperationRecord>> {
    let Some(operation_id) = store::read_optional_json::<String>(&state_root.join("active.json"))?
    else {
        return Ok(None);
    };
    let reason = match read_record(state_root, &operation_id)? {
        Ok(record) => match discard_reason(&record.journal, installed_digest, now) {
            None => return Ok(Some(record)),
            Some(reason) => reason,
        },
        Err(reason) => reason,
    };
    match discard_pointer(state_root, &operation_id) {
        Ok(true) => tracing::info!(
            operation_id = %operation_id,
            reason = reason.as_str(),
            "Removed the retained host-update outcome pointer"
        ),
        Ok(false) => {}
        Err(error) => tracing::warn!(
            operation_id = %operation_id,
            reason = reason.as_str(),
            err = %error,
            "Cannot remove the retained host-update outcome pointer"
        ),
    }
    Ok(None)
}

/// Reads one record. Absence and undecodable content are final and discard
/// the pointer; any other I/O failure may be transient and must not discard a
/// possibly live pointer, so it propagates.
fn read_record(
    state_root: &Path,
    operation_id: &str,
) -> io::Result<Result<OperationRecord, DiscardReason>> {
    let path = state_root
        .join("operations")
        .join(format!("{operation_id}.json"));
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Ok(Err(DiscardReason::Missing));
        }
        Err(error) => return Err(error),
    };
    Ok(serde_json::from_slice(&bytes).map_err(|_| DiscardReason::Corrupt))
}

/// Removes `active.json` only while it still names `operation_id`.
///
/// `apply()` and every journal transition write under `guardian.lock`, so the
/// compare and the removal happen under that lock and can never delete a newer
/// pointer. The lock is only tried: apply holds it across a network request,
/// and status must neither wait for that nor block its executor thread.
/// Returns whether the pointer was removed.
fn discard_pointer(state_root: &Path, operation_id: &str) -> io::Result<bool> {
    let Some(_lock) = store::try_lock(&state_root.join("guardian.lock"))? else {
        return Ok(false);
    };
    let pointer = state_root.join("active.json");
    let still_named = store::read_optional_json::<String>(&pointer)?
        .is_some_and(|current| current == operation_id);
    if !still_named {
        return Ok(false);
    }
    fs::remove_file(&pointer)?;
    store::sync_directory(state_root)?;
    Ok(true)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
#[path = "outcome_tests.rs"]
mod tests;
