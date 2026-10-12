//! Exact generation and identity proof for update outcomes. The product's
//! [`ServiceHealth`] proves the process; this module proves what is active.

use std::path::Path;

use super::{GenerationMetadataV1, OperationRecord, ServiceHealth, store};

pub(super) fn target_is_ready(
    root: &Path,
    health: &dyn ServiceHealth,
    operation: &OperationRecord,
) -> bool {
    let Ok(metadata) =
        store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json"))
    else {
        return false;
    };
    metadata.version == operation.target.version
        && metadata.build == operation.target.build
        && metadata.source_revision == operation.target.source_revision
        && metadata.artifact_digest == operation.target.sha256
        && identity_preserved(health, operation)
        && health.serves(&metadata, operation)
}

pub(super) fn rollback_is_ready(
    root: &Path,
    health: &dyn ServiceHealth,
    operation: &OperationRecord,
) -> bool {
    store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json")).is_ok_and(
        |metadata| {
            metadata.artifact_digest == operation.current.artifact_digest
                && metadata.version == operation.current.version
                && metadata.build == operation.current.build
                && metadata.source_revision == operation.current.source_revision
        },
    ) && identity_preserved(health, operation)
        && health.serves(&operation.current, operation)
}

fn identity_preserved(health: &dyn ServiceHealth, operation: &OperationRecord) -> bool {
    health.identity_pin(operation).as_deref() == Some(operation.identity_pin.as_str())
}
