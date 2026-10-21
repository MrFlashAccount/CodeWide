//! Lookups of thread working directories in the companion thread index,
//! used by workspace admission.

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
}
