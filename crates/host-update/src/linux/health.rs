//! Exact generation and identity proof for update outcomes. The product's
//! [`ServiceHealth`] proves the process; this module proves what is active.

use std::path::Path;

use super::{GenerationMetadataV1, ServiceHealth, ServiceHealthContext, store};

pub(super) fn target_is_ready(
    root: &Path,
    health: &dyn ServiceHealth,
    expected: &GenerationMetadataV1,
    context: &ServiceHealthContext,
) -> bool {
    let Ok(metadata) =
        store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json"))
    else {
        return false;
    };
    metadata == *expected
        && identity_preserved(health, context)
        && health.serves(&metadata, context)
}

pub(super) fn rollback_is_ready(
    root: &Path,
    health: &dyn ServiceHealth,
    previous: &GenerationMetadataV1,
    context: &ServiceHealthContext,
) -> bool {
    store::read_json::<GenerationMetadataV1>(&root.join("current/metadata.json"))
        .is_ok_and(|metadata| metadata == *previous)
        && identity_preserved(health, context)
        && health.serves(previous, context)
}

fn identity_preserved(health: &dyn ServiceHealth, context: &ServiceHealthContext) -> bool {
    health.identity_pin(context).as_deref() == Some(context.identity_pin.as_str())
}
