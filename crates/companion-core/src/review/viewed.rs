//! Companion-local viewed marks, used only for a pull request whose plugin
//! lacks `forge.viewed@1`. A mark is per companion, per source and path at
//! one revision; clients label it "Viewed · this companion".

use std::{collections::HashMap, sync::Arc};

use super::{ReviewError, source::DiffSource};
use crate::store::{IndexStore, kv::KvOp, review_tables::REVIEW_VIEWED_LOCAL};

#[derive(Clone)]
pub struct ViewedMarks {
    store: Arc<IndexStore>,
}

fn prefix(source: &DiffSource, revision: &str) -> String {
    format!("{}\0{revision}\0", source.storage_key())
}

impl ViewedMarks {
    #[must_use]
    pub fn new(store: Arc<IndexStore>) -> Self {
        Self { store }
    }

    /// Viewed paths of a source at a revision.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn marks(
        &self,
        source: &DiffSource,
        revision: &str,
    ) -> Result<HashMap<String, bool>, ReviewError> {
        let prefix = prefix(source, revision);
        Ok(self
            .store
            .kv_scan(REVIEW_VIEWED_LOCAL, &prefix)?
            .into_iter()
            .filter_map(|(key, _)| Some((key.strip_prefix(&prefix)?.to_owned(), true)))
            .collect())
    }

    /// Sets or clears one mark.
    ///
    /// # Errors
    ///
    /// Returns a storage failure.
    pub fn set(
        &self,
        source: &DiffSource,
        revision: &str,
        path: &str,
        viewed: bool,
    ) -> Result<(), ReviewError> {
        let key = format!("{}{path}", prefix(source, revision));
        let op = if viewed {
            KvOp::Put {
                table: REVIEW_VIEWED_LOCAL,
                key,
                value: b"1".to_vec(),
            }
        } else {
            KvOp::Delete {
                table: REVIEW_VIEWED_LOCAL,
                key,
            }
        };
        self.store.kv_apply(vec![op])?;
        Ok(())
    }
}
