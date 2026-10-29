//! Lookups of thread working directories in the companion thread index,
//! used by workspace admission.

use std::collections::HashMap;

use redb::{ReadableDatabase, ReadableTable};

use super::{IndexStore, IndexedThreadMetadata, StoreError, THREAD_METADATA};

impl IndexStore {
    /// Whether any indexed thread has exactly `cwd` as its working directory.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn has_thread_cwd(&self, cwd: &str) -> Result<bool, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(THREAD_METADATA)?;
        for entry in table.iter()? {
            let (_, value) = entry?;
            let Ok(metadata) = serde_json::from_slice::<IndexedThreadMetadata>(value.value())
            else {
                continue;
            };
            if metadata.cwd == cwd {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// Up to `limit` distinct non-empty thread working directories, the one
    /// whose latest thread was updated most recently first.
    ///
    /// # Errors
    /// Returns an error when the index cannot be read.
    pub fn recent_thread_cwds(&self, limit: usize) -> Result<Vec<String>, StoreError> {
        let read = self.database.begin_read()?;
        let table = read.open_table(THREAD_METADATA)?;
        let mut latest: HashMap<String, i64> = HashMap::new();
        for entry in table.iter()? {
            let (_, value) = entry?;
            let Ok(metadata) = serde_json::from_slice::<IndexedThreadMetadata>(value.value())
            else {
                continue;
            };
            if metadata.cwd.is_empty() {
                continue;
            }
            let updated = latest.entry(metadata.cwd).or_insert(metadata.updated_at);
            *updated = (*updated).max(metadata.updated_at);
        }
        let mut cwds: Vec<(String, i64)> = latest.into_iter().collect();
        // Ties fall back to the path, so the order is deterministic.
        cwds.sort_by(|(left_cwd, left), (right_cwd, right)| {
            right.cmp(left).then_with(|| left_cwd.cmp(right_cwd))
        });
        Ok(cwds.into_iter().take(limit).map(|(cwd, _)| cwd).collect())
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;

    fn thread(id: &str, cwd: &str, updated_at: i64) -> IndexedThreadMetadata {
        IndexedThreadMetadata {
            id: id.into(),
            parent_thread_id: None,
            cwd: cwd.into(),
            created_at: 0,
            updated_at,
            model_provider: "openai".into(),
            cli_version: "1".into(),
            source: json!("cli"),
            agent_nickname: None,
            agent_role: None,
            archived: false,
            running: None,
        }
    }

    #[test]
    fn recent_cwds_are_distinct_newest_first_and_bounded() {
        let directory = tempfile::tempdir().expect("dir");
        let store = IndexStore::open(directory.path().join("state.redb")).expect("store");
        store
            .put_thread_metadata_batch(&[
                thread("a", "/work/old", 10),
                thread("b", "/work/wt", 20),
                thread("c", "/work/old", 40),
                thread("d", "", 50),
                thread("e", "/work/other", 30),
            ])
            .expect("put");
        assert_eq!(
            store.recent_thread_cwds(10).expect("read"),
            vec!["/work/old", "/work/other", "/work/wt"]
        );
        assert_eq!(
            store.recent_thread_cwds(2).expect("read"),
            vec!["/work/old", "/work/other"]
        );
    }
}
