//! The journaled thread preview travels as a catalog topic, so a socket with
//! no interest still sees the answer streaming in an unsubscribed thread.

use std::sync::Arc;

use serde_json::{Value, json};

use super::{
    IngestInput, ingest_events,
    interest::{InterestRejection, SocketInterest},
    tests::ingest_context,
};
use crate::{
    store::IndexStore,
    thread_patch::THREAD_PATCH_FIELD,
    thread_preview::{THREAD_PREVIEW_KIND, THREAD_PREVIEW_METHOD},
};

#[tokio::test]
async fn a_streamed_answer_journals_a_catalog_preview_after_its_delta()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let store = Arc::new(IndexStore::open(directory.path().join("preview.redb"))?);
    let (ingest, receiver) = tokio::sync::mpsc::channel(8);
    let (signals, _) = tokio::sync::broadcast::channel(8);
    let (fence, resolved) = tokio::sync::oneshot::channel();
    let context = ingest_context(&store, signals);
    let task = tokio::spawn(ingest_events(receiver, context));
    let delta = |text: &str| {
        json!({"method": "item/agentMessage/delta", "params": {
            "threadId": "thread", "turnId": "turn", "itemId": "answer", "delta": text
        }})
    };
    // Both deltas arrive in one batch and coalesce into one journal entry.
    ingest.send(IngestInput::Payload(delta("Hel"))).await?;
    ingest.send(IngestInput::Payload(delta("lo"))).await?;
    ingest.send(IngestInput::Fence(fence)).await?;
    assert_eq!(
        resolved.await??,
        2,
        "one delta entry plus one preview entry"
    );

    let journal = store
        .replay_after(Some(0))?
        .entries
        .into_iter()
        .map(|(_, bytes)| serde_json::from_slice::<Value>(&bytes))
        .collect::<Result<Vec<_>, _>>()?;
    assert_eq!(journal[0]["method"], "item/agentMessage/delta");
    assert_eq!(journal[0]["params"]["delta"], "Hello");
    assert_eq!(
        journal[0][THREAD_PATCH_FIELD]["operation"]["kind"],
        "itemTextDelta"
    );
    assert_eq!(journal[1]["method"], THREAD_PREVIEW_METHOD);
    assert_eq!(journal[1][THREAD_PATCH_FIELD]["threadId"], "thread");
    assert_eq!(
        journal[1][THREAD_PATCH_FIELD]["operation"]["kind"],
        THREAD_PREVIEW_KIND
    );
    assert_eq!(
        journal[1][THREAD_PATCH_FIELD]["operation"]["summary"]["previewText"],
        "Hello"
    );
    let interest =
        SocketInterest::from_hello(&json!({"interest": []})).map_err(InterestRejection::reason)?;
    assert!(!interest.delivers(&journal[0]));
    assert!(interest.delivers(&journal[1]));
    drop(ingest);
    task.await?;
    Ok(())
}
