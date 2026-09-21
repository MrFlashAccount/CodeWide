//! Durable per-authenticated-context V2 thread read receipts.

use std::collections::HashSet;

use redb::{ReadTransaction, ReadableDatabase, ReadableTable, TableDefinition, WriteTransaction};

use super::{IndexStore, StoreError};

const ACTIVITY_HEADS: TableDefinition<&str, u64> =
    TableDefinition::new("sync_v2_thread_activity_heads");
const ACTIVITY_KNOWLEDGE: TableDefinition<&str, u8> =
    TableDefinition::new("sync_v2_thread_activity_knowledge");
const ACTIVITY_LATEST: TableDefinition<&str, &str> =
    TableDefinition::new("sync_v2_thread_activity_latest");
const ACTIVITY_MARKERS: TableDefinition<&[u8], u64> =
    TableDefinition::new("sync_v2_thread_activity_markers");
const READ_RECEIPTS: TableDefinition<&[u8], &str> =
    TableDefinition::new("sync_v2_thread_read_receipts");

const COMPLETE_KNOWLEDGE: u8 = 1;
const MAX_KEY_PART_BYTES: usize = 256;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct StoredThreadReadState {
    pub latest_activity_marker: Option<String>,
    pub read_through_marker: Option<String>,
    pub unread_count: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum StoredMarkReadOutcome {
    Marked(StoredThreadReadState),
    UnknownMarker(StoredThreadReadState),
}

pub(super) fn open_tables(write: &WriteTransaction) -> Result<(), StoreError> {
    write.open_table(ACTIVITY_HEADS)?;
    write.open_table(ACTIVITY_KNOWLEDGE)?;
    write.open_table(ACTIVITY_LATEST)?;
    write.open_table(ACTIVITY_MARKERS)?;
    write.open_table(READ_RECEIPTS)?;
    Ok(())
}

impl IndexStore {
    pub(crate) fn thread_read_state(
        &self,
        context_key: &str,
        thread_id: &str,
    ) -> Result<StoredThreadReadState, StoreError> {
        validate_key_part(context_key, "read receipt context")?;
        validate_key_part(thread_id, "read receipt thread")?;
        let receipt_key = composite_key(context_key, thread_id)?;
        let read = self.database.begin_read()?;
        let knowledge = read.open_table(ACTIVITY_KNOWLEDGE)?;
        let latest = read.open_table(ACTIVITY_LATEST)?;
        let receipts = read.open_table(READ_RECEIPTS)?;
        let latest_activity_marker = latest.get(thread_id)?.map(|value| value.value().to_owned());
        let read_through_marker = receipts
            .get(receipt_key.as_slice())?
            .map(|value| value.value().to_owned());
        let complete = knowledge
            .get(thread_id)?
            .is_some_and(|value| value.value() == COMPLETE_KNOWLEDGE);
        let unread_count = if complete {
            known_unread_count(&read, thread_id, read_through_marker.as_deref())?
        } else if latest_activity_marker.is_some() && latest_activity_marker == read_through_marker
        {
            Some(0)
        } else {
            None
        };
        Ok(StoredThreadReadState {
            latest_activity_marker,
            read_through_marker,
            unread_count,
        })
    }

    pub(crate) fn reconcile_thread_read_activities(
        &self,
        thread_id: &str,
        ordered_markers: &[String],
        complete: bool,
    ) -> Result<(), StoreError> {
        validate_key_part(thread_id, "read receipt thread")?;
        validate_markers(ordered_markers)?;
        if complete {
            return self.replace_thread_read_activities(thread_id, ordered_markers);
        }
        self.seed_thread_read_activities(thread_id, ordered_markers)
    }

    pub(crate) fn note_thread_read_activity(
        &self,
        thread_id: &str,
        marker: &str,
    ) -> Result<(), StoreError> {
        validate_key_part(thread_id, "read receipt thread")?;
        validate_key_part(marker, "read activity marker")?;
        let marker_key = composite_key(thread_id, marker)?;
        let write = self.database.begin_write()?;
        {
            let mut knowledge = write.open_table(ACTIVITY_KNOWLEDGE)?;
            let mut latest = write.open_table(ACTIVITY_LATEST)?;
            let mut markers = write.open_table(ACTIVITY_MARKERS)?;
            let complete = knowledge
                .get(thread_id)?
                .is_some_and(|value| value.value() == COMPLETE_KNOWLEDGE);
            let marker_is_new = markers.get(marker_key.as_slice())?.is_none();
            if marker_is_new {
                let mut heads = write.open_table(ACTIVITY_HEADS)?;
                let sequence = heads
                    .get(thread_id)?
                    .map_or(1, |value| value.value().saturating_add(1));
                markers.insert(marker_key.as_slice(), sequence)?;
                heads.insert(thread_id, sequence)?;
            }
            if !complete {
                knowledge.insert(thread_id, 0)?;
            }
            if marker_is_new {
                latest.insert(thread_id, marker)?;
            }
        }
        write.commit()?;
        Ok(())
    }

    pub(crate) fn mark_thread_read(
        &self,
        context_key: &str,
        thread_id: &str,
        through_marker: &str,
    ) -> Result<StoredMarkReadOutcome, StoreError> {
        validate_key_part(context_key, "read receipt context")?;
        validate_key_part(thread_id, "read receipt thread")?;
        validate_key_part(through_marker, "read activity marker")?;
        let receipt_key = composite_key(context_key, thread_id)?;
        let target_key = composite_key(thread_id, through_marker)?;
        let write = self.database.begin_write()?;
        let accepted = {
            let knowledge = write.open_table(ACTIVITY_KNOWLEDGE)?;
            let latest = write.open_table(ACTIVITY_LATEST)?;
            let markers = write.open_table(ACTIVITY_MARKERS)?;
            let complete = knowledge
                .get(thread_id)?
                .is_some_and(|value| value.value() == COMPLETE_KNOWLEDGE);
            let target_sequence = markers
                .get(target_key.as_slice())?
                .map(|value| value.value());
            let latest_matches = latest
                .get(thread_id)?
                .is_some_and(|value| value.value() == through_marker);
            if !complete {
                if latest_matches {
                    let mut receipts = write.open_table(READ_RECEIPTS)?;
                    receipts.insert(receipt_key.as_slice(), through_marker)?;
                    true
                } else {
                    false
                }
            } else if let Some(target_sequence) = target_sequence {
                let mut receipts = write.open_table(READ_RECEIPTS)?;
                let retained = receipts
                    .get(receipt_key.as_slice())?
                    .map(|value| value.value().to_owned());
                let retained_sequence = match retained.as_deref() {
                    Some(marker) => {
                        let key = composite_key(thread_id, marker)?;
                        markers.get(key.as_slice())?.map(|value| value.value())
                    }
                    None => None,
                };
                match (retained.as_ref(), retained_sequence) {
                    (None, None) => {
                        receipts.insert(receipt_key.as_slice(), through_marker)?;
                        true
                    }
                    (Some(_), Some(retained_sequence)) => {
                        if target_sequence > retained_sequence {
                            receipts.insert(receipt_key.as_slice(), through_marker)?;
                        }
                        true
                    }
                    (Some(_), None) => false,
                    (None, Some(_)) => unreachable!("a missing receipt has no sequence"),
                }
            } else {
                false
            }
        };
        write.commit()?;
        let state = self.thread_read_state(context_key, thread_id)?;
        Ok(if accepted {
            StoredMarkReadOutcome::Marked(state)
        } else {
            StoredMarkReadOutcome::UnknownMarker(state)
        })
    }

    pub(crate) fn delete_thread_read_state(&self, thread_id: &str) -> Result<(), StoreError> {
        validate_key_part(thread_id, "read receipt thread")?;
        let write = self.database.begin_write()?;
        {
            write.open_table(ACTIVITY_HEADS)?.remove(thread_id)?;
            write.open_table(ACTIVITY_KNOWLEDGE)?.remove(thread_id)?;
            write.open_table(ACTIVITY_LATEST)?.remove(thread_id)?;
            write
                .open_table(ACTIVITY_MARKERS)?
                .retain(|key, _value| !first_part_matches(key, thread_id.as_bytes()))?;
            write
                .open_table(READ_RECEIPTS)?
                .retain(|key, _value| !second_part_matches(key, thread_id.as_bytes()))?;
        }
        write.commit()?;
        Ok(())
    }

    pub(crate) fn purge_thread_read_context(&self, context_key: &str) -> Result<(), StoreError> {
        validate_key_part(context_key, "read receipt context")?;
        let write = self.database.begin_write()?;
        write
            .open_table(READ_RECEIPTS)?
            .retain(|key, _value| !first_part_matches(key, context_key.as_bytes()))?;
        write.commit()?;
        Ok(())
    }

    fn replace_thread_read_activities(
        &self,
        thread_id: &str,
        ordered_markers: &[String],
    ) -> Result<(), StoreError> {
        let authoritative_markers = ordered_markers
            .iter()
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let write = self.database.begin_write()?;
        {
            let mut heads = write.open_table(ACTIVITY_HEADS)?;
            let mut knowledge = write.open_table(ACTIVITY_KNOWLEDGE)?;
            let mut latest = write.open_table(ACTIVITY_LATEST)?;
            let mut markers = write.open_table(ACTIVITY_MARKERS)?;
            let mut receipts = write.open_table(READ_RECEIPTS)?;
            markers.retain(|key, _value| !first_part_matches(key, thread_id.as_bytes()))?;
            receipts.retain(|key, value| {
                !second_part_matches(key, thread_id.as_bytes())
                    || authoritative_markers.contains(value)
            })?;
            heads.remove(thread_id)?;
            latest.remove(thread_id)?;
            for (index, marker) in ordered_markers.iter().enumerate() {
                let sequence = u64::try_from(index)
                    .map_err(|_| StoreError::CorruptedIndex("too many read activities".into()))?
                    .saturating_add(1);
                let marker_key = composite_key(thread_id, marker)?;
                markers.insert(marker_key.as_slice(), sequence)?;
                heads.insert(thread_id, sequence)?;
                latest.insert(thread_id, marker.as_str())?;
            }
            knowledge.insert(thread_id, COMPLETE_KNOWLEDGE)?;
        }
        write.commit()?;
        Ok(())
    }

    fn seed_thread_read_activities(
        &self,
        thread_id: &str,
        ordered_markers: &[String],
    ) -> Result<(), StoreError> {
        let write = self.database.begin_write()?;
        {
            let mut latest = write.open_table(ACTIVITY_LATEST)?;
            if latest.get(thread_id)?.is_none() && !ordered_markers.is_empty() {
                let mut heads = write.open_table(ACTIVITY_HEADS)?;
                let mut knowledge = write.open_table(ACTIVITY_KNOWLEDGE)?;
                let mut markers = write.open_table(ACTIVITY_MARKERS)?;
                let mut sequence = heads.get(thread_id)?.map_or(0, |value| value.value());
                for marker in ordered_markers {
                    let marker_key = composite_key(thread_id, marker)?;
                    if markers.get(marker_key.as_slice())?.is_some() {
                        continue;
                    }
                    sequence = sequence.saturating_add(1);
                    markers.insert(marker_key.as_slice(), sequence)?;
                }
                heads.insert(thread_id, sequence)?;
                knowledge.insert(thread_id, 0)?;
                if let Some(marker) = ordered_markers.last() {
                    latest.insert(thread_id, marker.as_str())?;
                }
            }
        }
        write.commit()?;
        Ok(())
    }
}

fn known_unread_count(
    read: &ReadTransaction,
    thread_id: &str,
    read_through_marker: Option<&str>,
) -> Result<Option<u64>, StoreError> {
    let heads = read.open_table(ACTIVITY_HEADS)?;
    let head = heads.get(thread_id)?.map_or(0, |value| value.value());
    let Some(read_through_marker) = read_through_marker else {
        return Ok(Some(head));
    };
    let markers = read.open_table(ACTIVITY_MARKERS)?;
    let key = composite_key(thread_id, read_through_marker)?;
    Ok(markers
        .get(key.as_slice())?
        .map(|value| head.saturating_sub(value.value())))
}

fn validate_markers(markers: &[String]) -> Result<(), StoreError> {
    let mut unique = HashSet::with_capacity(markers.len());
    for marker in markers {
        validate_key_part(marker, "read activity marker")?;
        if !unique.insert(marker.as_str()) {
            return Err(StoreError::CorruptedIndex(
                "duplicate read activity marker".into(),
            ));
        }
    }
    Ok(())
}

fn validate_key_part(value: &str, label: &str) -> Result<(), StoreError> {
    if value.is_empty() || value.len() > MAX_KEY_PART_BYTES {
        return Err(StoreError::CorruptedIndex(format!("invalid {label}")));
    }
    Ok(())
}

fn composite_key(first: &str, second: &str) -> Result<Vec<u8>, StoreError> {
    let first_length = u32::try_from(first.len())
        .map_err(|_| StoreError::CorruptedIndex("read receipt key is too long".into()))?;
    let mut key = Vec::with_capacity(4 + first.len() + second.len());
    key.extend_from_slice(&first_length.to_be_bytes());
    key.extend_from_slice(first.as_bytes());
    key.extend_from_slice(second.as_bytes());
    Ok(key)
}

fn first_part_matches(key: &[u8], expected: &[u8]) -> bool {
    split_key(key).is_some_and(|(first, _second)| first == expected)
}

fn second_part_matches(key: &[u8], expected: &[u8]) -> bool {
    split_key(key).is_some_and(|(_first, second)| second == expected)
}

fn split_key(key: &[u8]) -> Option<(&[u8], &[u8])> {
    let length = key.get(..4)?.try_into().ok().map(u32::from_be_bytes)? as usize;
    let first_end = 4_usize.checked_add(length)?;
    Some((key.get(4..first_end)?, key.get(first_end..)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{IndexedThreadMetadata, META, THREAD_METADATA};

    #[test]
    fn schema_six_migration_keeps_existing_index_rows() -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("index.redb");
        let metadata = IndexedThreadMetadata {
            id: "thread-a".into(),
            parent_thread_id: None,
            cwd: "/workspace".into(),
            created_at: 1,
            updated_at: 2,
            model_provider: "openai".into(),
            cli_version: "1.0.0".into(),
            source: serde_json::json!({"kind": "cli"}),
            agent_nickname: None,
            agent_role: None,
            archived: false,
        };
        {
            let database = redb::Database::create(&path)?;
            let write = database.begin_write()?;
            {
                write.open_table(META)?.insert("schema_version", 6_u64)?;
                let encoded = serde_json::to_vec(&metadata)?;
                write
                    .open_table(THREAD_METADATA)?
                    .insert(metadata.id.as_str(), encoded.as_slice())?;
            }
            write.commit()?;
        }

        let store = IndexStore::open(&path)?;

        assert_eq!(store.schema_version(), 7);
        assert_eq!(store.thread_metadata("thread-a")?, Some(metadata));
        assert_eq!(
            store.thread_read_state("device-a", "thread-a")?,
            StoredThreadReadState {
                latest_activity_marker: None,
                read_through_marker: None,
                unread_count: None,
            }
        );
        Ok(())
    }
}
