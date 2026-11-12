//! Durable tables of the review context. Values are versioned JSON owned by
//! `crate::review`; this module only names the tables.

use redb::TableDefinition;

use super::kv::BytesTable;

/// `sourceKey NUL draftId` → draft comment.
pub(crate) const REVIEW_DRAFTS: BytesTable = TableDefinition::new("review_drafts");
/// `sourceKey` → the latest valid guide and its pending request.
pub(crate) const REVIEW_GUIDES: BytesTable = TableDefinition::new("review_guides");
/// `sourceKey NUL stopId` → stop progress.
pub(crate) const REVIEW_GUIDE_PROGRESS: BytesTable = TableDefinition::new("review_guide_progress");
/// `sourceKey NUL revision NUL path` → companion-local viewed mark.
pub(crate) const REVIEW_VIEWED_LOCAL: BytesTable = TableDefinition::new("review_viewed_local");
