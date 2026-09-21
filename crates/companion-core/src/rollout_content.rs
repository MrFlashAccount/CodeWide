use std::{path::Path, sync::Arc};

use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::store::{
    IndexStore, RecordRef, RolloutContentEntry, RolloutContentField, RolloutContentLocator,
    StoreError,
};

const MAX_SOURCE_RECORD_BYTES: usize = 64 * 1024 * 1024;
const TEXT_CONTENT_TYPE: &str = "text/plain; charset=utf-8";

pub(crate) struct RolloutContent {
    pub(crate) bytes: Arc<[u8]>,
    pub(crate) content_type: String,
}

pub(crate) fn entries_from_record(
    source_path: &Path,
    file_id: [u8; 32],
    record: RecordRef,
    line: &[u8],
) -> Vec<RolloutContentEntry> {
    let prefix = &line[..line.len().min(8 * 1024)];
    if memchr::memmem::find(prefix, b"\"type\":\"item_completed\"").is_none()
        && memchr::memmem::find(prefix, b"\"type\":\"exec_command_end\"").is_none()
    {
        return Vec::new();
    }
    let Ok(envelope) = serde_json::from_slice::<Value>(line) else {
        return Vec::new();
    };
    let Some(payload) = envelope.get("payload") else {
        return Vec::new();
    };
    let kind = payload.get("type").and_then(Value::as_str);
    let (item_id, output, field) = if kind == Some("item_completed") {
        let Some(item) = payload.get("item") else {
            return Vec::new();
        };
        if !matches!(
            item.get("type").and_then(Value::as_str),
            Some("CommandExecution" | "commandExecution")
        ) {
            return Vec::new();
        }
        let Some(item_id) = item.get("id").and_then(Value::as_str) else {
            return Vec::new();
        };
        let Some(output) = item
            .get("aggregated_output")
            .or_else(|| item.get("aggregatedOutput"))
            .and_then(Value::as_str)
            .filter(|output| !output.is_empty())
        else {
            return Vec::new();
        };
        (
            item_id,
            output,
            RolloutContentField::CommandAggregatedOutput,
        )
    } else if kind == Some("exec_command_end") {
        let Some(item_id) = payload
            .get("call_id")
            .or_else(|| payload.get("item_id"))
            .and_then(Value::as_str)
        else {
            return Vec::new();
        };
        let Some(output) = payload
            .get("aggregated_output")
            .or_else(|| payload.get("aggregatedOutput"))
            .and_then(Value::as_str)
            .filter(|output| !output.is_empty())
        else {
            return Vec::new();
        };
        (
            item_id,
            output,
            RolloutContentField::ExecCommandAggregatedOutput,
        )
    } else {
        return Vec::new();
    };
    let digest = Sha256::digest(output.as_bytes()).into();
    vec![RolloutContentEntry {
        digest,
        locator: RolloutContentLocator {
            source_path: source_path.to_path_buf(),
            file_id,
            record,
            thread_id: payload
                .get("thread_id")
                .or_else(|| payload.get("threadId"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            turn_id: payload
                .get("turn_id")
                .or_else(|| payload.get("turnId"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
            item_id: item_id.to_owned(),
            field,
            content_type: TEXT_CONTENT_TYPE.to_owned(),
        },
    }]
}

pub(crate) async fn load(
    store: &IndexStore,
    digest: &str,
) -> Result<Option<RolloutContent>, StoreError> {
    let Ok(digest_bytes) = hex::decode(digest) else {
        return Ok(None);
    };
    let Ok(digest_bytes) = <[u8; 32]>::try_from(digest_bytes) else {
        return Ok(None);
    };
    for locator in store.rollout_content(&digest_bytes)? {
        if let Some(content) = load_candidate(&locator, &digest_bytes).await {
            return Ok(Some(content));
        }
    }
    Ok(None)
}

async fn load_candidate(
    locator: &RolloutContentLocator,
    expected_digest: &[u8; 32],
) -> Option<RolloutContent> {
    let length = usize::try_from(locator.record.length).ok()?;
    if length == 0 || length > MAX_SOURCE_RECORD_BYTES {
        return None;
    }
    let mut file = tokio::fs::File::open(&locator.source_path).await.ok()?;
    file.seek(std::io::SeekFrom::Start(locator.record.offset))
        .await
        .ok()?;
    let mut line = vec![0; length];
    file.read_exact(&mut line).await.ok()?;
    let envelope = serde_json::from_slice::<Value>(&line).ok()?;
    let bytes = extract(envelope, locator)?.into_bytes();
    let actual_digest: [u8; 32] = Sha256::digest(&bytes).into();
    if &actual_digest != expected_digest {
        return None;
    }
    Some(RolloutContent {
        bytes: Arc::from(bytes),
        content_type: locator.content_type.clone(),
    })
}

fn extract(mut envelope: Value, locator: &RolloutContentLocator) -> Option<String> {
    let payload = envelope.get_mut("payload")?.as_object_mut()?;
    if locator.thread_id.as_deref().is_some_and(|expected| {
        payload
            .get("thread_id")
            .or_else(|| payload.get("threadId"))
            .and_then(Value::as_str)
            != Some(expected)
    }) || locator.turn_id.as_deref().is_some_and(|expected| {
        payload
            .get("turn_id")
            .or_else(|| payload.get("turnId"))
            .and_then(Value::as_str)
            != Some(expected)
    }) {
        return None;
    }
    match locator.field {
        RolloutContentField::CommandAggregatedOutput => {
            let item = payload.get_mut("item")?.as_object_mut()?;
            if item.get("id").and_then(Value::as_str) != Some(locator.item_id.as_str()) {
                return None;
            }
            item.remove("aggregated_output")
                .or_else(|| item.remove("aggregatedOutput"))?
                .as_str()
                .map(ToOwned::to_owned)
        }
        RolloutContentField::ExecCommandAggregatedOutput => {
            if payload
                .get("call_id")
                .or_else(|| payload.get("item_id"))
                .and_then(Value::as_str)
                != Some(locator.item_id.as_str())
            {
                return None;
            }
            payload
                .remove("aggregated_output")
                .or_else(|| payload.remove("aggregatedOutput"))?
                .as_str()
                .map(ToOwned::to_owned)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rollout::{index_rollout_fully, rollout_file_id};

    #[test]
    fn indexes_only_materialized_command_output() {
        let line = br#"{"type":"event_msg","payload":{"type":"item_completed","thread_id":"thread","turn_id":"turn","item":{"type":"CommandExecution","id":"command","aggregated_output":"hello"}}}"#;
        let entries = entries_from_record(
            Path::new("/tmp/rollout.jsonl"),
            [7; 32],
            RecordRef {
                offset: 10,
                length: u32::try_from(line.len()).unwrap_or(u32::MAX),
                record_type: 3,
            },
            line,
        );
        assert_eq!(entries.len(), 1);
        let expected_digest: [u8; 32] = Sha256::digest(b"hello").into();
        assert_eq!(entries[0].digest, expected_digest);
        assert_eq!(entries[0].locator.item_id, "command");
    }

    #[tokio::test]
    async fn reads_indexed_output_from_the_canonical_rollout()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let rollout = directory.path().join("rollout.jsonl");
        std::fs::write(
            &rollout,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"thread\",\"cwd\":\"/tmp\",\"timestamp\":\"2026-01-01T00:00:00Z\"}}\n",
                "{\"type\":\"event_msg\",\"payload\":{\"type\":\"item_completed\",\"thread_id\":\"thread\",\"turn_id\":\"turn\",\"item\":{\"type\":\"CommandExecution\",\"id\":\"command\",\"aggregated_output\":\"canonical output\"}}}\n",
            ),
        )?;
        let store = IndexStore::open(directory.path().join("index.redb"))?;
        index_rollout_fully(&store, &rollout)?;

        let digest = hex::encode(Sha256::digest(b"canonical output"));
        let content = load(&store, &digest)
            .await
            .ok()
            .flatten()
            .ok_or("content")?;
        assert_eq!(content.bytes.as_ref(), b"canonical output");

        store.reset_file(&rollout_file_id(&rollout))?;
        assert!(load(&store, &digest).await?.is_none());
        Ok(())
    }
}
