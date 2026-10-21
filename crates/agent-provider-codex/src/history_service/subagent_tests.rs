//! A sub-agent child's history is its own turns only: Codex copies the
//! parent's history into the child's rollout before the child's own records,
//! and none of the copy is served as the child's.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde_json::{Value, json};

use super::{
    HistoryService, HistoryServiceError, SOURCE_WITNESS_PREFIX, URL_SAFE_NO_PAD,
    fork_tests::{
        FORK, PARENT, TestResult, all_pages, append, completed_turn, completed_turns, event, ids,
        page_ids, rollout_path, service, session_meta, write_fork, write_parent_forked_mid_turn,
    },
};
use crate::rollout_monitor::RolloutChange;

const CHILD: &str = "019fe7af-1000-7000-8000-000000000010";
const ROOT: &str = "019fe7af-0000-7000-8000-0000000000ff";

fn spawn_source() -> Value {
    json!({"subagent": {"thread_spawn": {"parent_thread_id": PARENT, "depth": 1,
        "agent_path": "/root/worker", "agent_nickname": "Worker", "agent_role": "worker"}}})
}

fn child_header(fields: &Value) -> Value {
    let mut payload = json!({"id": CHILD, "history_mode": "paginated", "source": spawn_source()});
    if let (Some(payload), Some(fields)) = (payload.as_object_mut(), fields.as_object()) {
        payload.extend(fields.clone());
    }
    json!({"type": "session_meta", "payload": payload})
}

/// The parent's history as Codex copies it into a child spawned while the
/// parent's turn `spawning` runs: the parent's header, its compaction, its
/// finished turns and the start of the spawning turn.
fn copied_parent_history(finished: &[&str], spawning: &str) -> Vec<Value> {
    let mut records = vec![
        session_meta(PARENT, None),
        json!({"type": "compacted", "payload": {"message": ""}}),
    ];
    records.extend(completed_turns(finished));
    records.push(event(&json!({"type": "task_started", "turn_id": spawning})));
    records.push(event(
        &json!({"type": "user_message", "message": "spawn a worker"}),
    ));
    records
}

/// A child spawned with the parent's turns, as Codex 0.161 and later write
/// it: the header names the record its own history starts at.
fn write_child_with_copied_history(root: &Path) -> Result<PathBuf, Box<dyn std::error::Error>> {
    let copied = copied_parent_history(&["p0", "p1"], "p2");
    let path = rollout_path(root, CHILD)?;
    append(
        &path,
        &[child_header(&json!({"forked_from_id": PARENT,
            "subagent_history_start_ordinal": 1 + copied.len()}))],
    )?;
    append(&path, &copied)?;
    append(&path, &[event(&json!({"type": "thread_settings_applied"}))])?;
    Ok(path)
}

async fn turns_page(
    service: &HistoryService,
    params: &Value,
) -> Result<Value, Box<dyn std::error::Error>> {
    Ok(service
        .try_turns_page("thread/turns/list", params)
        .await
        .ok_or("turn page was not handled")??)
}

async fn assert_only_own_turns(service: &HistoryService) -> TestResult {
    assert_eq!(
        page_ids(&all_pages(service, CHILD, 10).await?),
        [vec!["c1", "c0"]]
    );
    assert_eq!(
        page_ids(&all_pages(service, CHILD, 1).await?),
        [vec!["c1"], vec!["c0"]]
    );

    let reset = service.sync_thread_history(CHILD, None, 10, None).await?;
    assert_eq!(reset["kind"], "reset");
    assert_eq!(ids(&reset["turns"]), ["c0", "c1"]);
    assert!(reset["olderCursor"].is_null());
    let short = service.sync_thread_history(CHILD, None, 1, None).await?;
    assert_eq!(ids(&short["turns"]), ["c1"]);
    let older = turns_page(
        service,
        &json!({"threadId": CHILD, "cursor": short["olderCursor"], "limit": 10,
            "sortDirection": "desc", "itemsView": "summary"}),
    )
    .await?;
    assert_eq!(ids(&older["data"]), ["c0"]);
    assert!(older["nextCursor"].is_null());
    let delta = service
        .sync_thread_history(CHILD, Some("c0"), 10, None)
        .await?;
    assert_eq!(delta["kind"], "delta");
    assert_eq!(ids(&delta["turns"]), ["c1"]);

    let before = service
        .turns_before(&json!({"threadId": CHILD, "beforeTurnId": "c1", "limit": 5}))
        .await?;
    assert_eq!(ids(&before["data"]), ["c0"]);
    assert_eq!(before["hasMore"], false);
    let start = service
        .turns_before(&json!({"threadId": CHILD, "beforeTurnId": "c0", "limit": 5}))
        .await?;
    assert_eq!(ids(&start["data"]), Vec::<&str>::new());
    assert_eq!(start["hasMore"], false);
    let after = service
        .turns_after(&json!({"threadId": CHILD, "afterTurnId": "c0", "limit": 5}))
        .await?;
    assert_eq!(ids(&after["data"]), ["c1"]);
    // A copied parent turn is not a turn of the child.
    for anchor in ["p1", "p2"] {
        assert!(matches!(
            service
                .turns_before(&json!({"threadId": CHILD, "beforeTurnId": anchor, "limit": 5}))
                .await,
            Err(HistoryServiceError::InvalidCursor)
        ));
    }

    let thread = service.enrich_thread(json!({"id": CHILD})).await;
    assert_eq!(thread["preview"], "answer c1");
    Ok(())
}

#[tokio::test]
async fn a_child_serves_none_of_the_parent_history_codex_copied_into_it() -> TestResult {
    let directory = tempfile::tempdir()?;
    let path = write_child_with_copied_history(directory.path())?;

    // Before its first turn, the child has no history and no preview.
    let service = service(directory.path())?;
    let empty = service.sync_thread_history(CHILD, None, 10, None).await?;
    assert_eq!(ids(&empty["turns"]), Vec::<&str>::new());
    assert!(empty["headTurnId"].is_null());
    assert_eq!(
        page_ids(&all_pages(&service, CHILD, 10).await?),
        [Vec::<&str>::new()]
    );
    assert_eq!(
        service.enrich_thread(json!({"id": CHILD})).await["preview"],
        ""
    );

    append(&path, &completed_turns(&["c0", "c1"]))?;
    assert_only_own_turns(&service).await?;
    let invalidation = service
        .rollout_invalidation_event(RolloutChange {
            thread_id: CHILD.to_owned(),
            path: path.clone(),
            archived: false,
        })
        .await?
        .ok_or("a finished child turn publishes an invalidation")?;
    assert_eq!(
        invalidation["codewideThreadPatch"]["operation"]["summary"]["previewText"],
        "answer c1"
    );
    // The same reads once the index covers the whole rollout, copy included.
    crate::rollout::index_rollout_fully(&service.store, &path)?;
    assert_only_own_turns(&service).await
}

#[tokio::test]
async fn a_client_holding_the_copied_parent_history_resets_once() -> TestResult {
    let directory = tempfile::tempdir()?;
    let path = write_child_with_copied_history(directory.path())?;
    append(&path, &completed_turns(&["c0", "c1"]))?;
    let service = service(directory.path())?;
    let reset = service.sync_thread_history(CHILD, None, 10, None).await?;
    let witness = reset["sourceWitness"]
        .as_str()
        .ok_or("reset has a witness")?;

    let current = service
        .sync_thread_history_with_source(CHILD, Some("c1"), 10, None, Some(witness))
        .await?;
    assert_eq!(current["kind"], "current");

    // The witness an earlier companion issued while it served the copy.
    let encoded = witness
        .strip_prefix(SOURCE_WITNESS_PREFIX)
        .ok_or("witness prefix")?;
    let mut decoded: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded)?)?;
    decoded
        .as_object_mut()
        .ok_or("witness object")?
        .remove("excludes_inherited")
        .ok_or("a child's witness marks the excluded copy")?;
    let earlier = format!(
        "{SOURCE_WITNESS_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&decoded)?)
    );
    let refreshed = service
        .sync_thread_history_with_source(CHILD, Some("c1"), 10, None, Some(&earlier))
        .await?;
    assert_eq!(refreshed["kind"], "reset");
    assert_eq!(ids(&refreshed["turns"]), ["c0", "c1"]);
    Ok(())
}

#[tokio::test]
async fn a_child_spawned_without_the_parent_history_keeps_every_turn() -> TestResult {
    let directory = tempfile::tempdir()?;
    let path = rollout_path(directory.path(), CHILD)?;
    append(&path, &[child_header(&json!({}))])?;
    // Older than the child's id: no time cut applies to a child that copied nothing.
    let early = "019fe7af-0001-7000-8000-0000000000a0";
    append(&path, &completed_turns(&[early, "c0"]))?;
    let service = service(directory.path())?;

    assert_eq!(
        page_ids(&all_pages(&service, CHILD, 10).await?),
        [vec!["c0", early]]
    );
    let reset = service.sync_thread_history(CHILD, None, 10, None).await?;
    assert_eq!(ids(&reset["turns"]), [early, "c0"]);
    Ok(())
}

#[tokio::test]
async fn an_older_child_without_the_start_ordinal_keeps_the_turns_minted_after_it() -> TestResult {
    let directory = tempfile::tempdir()?;
    let parent_turns = [
        "019fe7af-0001-7000-8000-0000000000a0",
        "019fe7af-0002-7000-8000-0000000000a1",
    ];
    let spawning = "019fe7af-0003-7000-8000-0000000000a2";
    let own = [
        "019fe7af-2000-7000-8000-0000000000c0",
        "019fe7af-2001-7000-8000-0000000000c1",
    ];
    let path = rollout_path(directory.path(), CHILD)?;
    append(&path, &[child_header(&json!({"forked_from_id": PARENT}))])?;
    append(&path, &copied_parent_history(&parent_turns, spawning))?;
    append(&path, &completed_turns(&own))?;
    let service = service(directory.path())?;

    assert_eq!(
        page_ids(&all_pages(&service, CHILD, 10).await?),
        [vec![own[1], own[0]]]
    );
    let reset = service.sync_thread_history(CHILD, None, 10, None).await?;
    assert_eq!(ids(&reset["turns"]), own);
    let before = service
        .turns_before(&json!({"threadId": CHILD, "beforeTurnId": own[0], "limit": 5}))
        .await?;
    assert_eq!(ids(&before["data"]), Vec::<&str>::new());
    Ok(())
}

#[tokio::test]
async fn a_user_fork_of_the_same_parent_keeps_its_inherited_history() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &["f0"])?;
    let child = write_child_with_copied_history(directory.path())?;
    append(&child, &completed_turn("c0"))?;
    let service = service(directory.path())?;

    let fork = service.sync_thread_history(FORK, None, 20, None).await?;
    assert_eq!(
        ids(&fork["turns"]),
        ["p0", "p1", "p2", "p3", "p4", "p5", "f0"]
    );
    let child = service.sync_thread_history(CHILD, None, 20, None).await?;
    assert_eq!(ids(&child["turns"]), ["c0"]);
    Ok(())
}

#[tokio::test]
async fn the_copied_parent_header_does_not_overwrite_the_parent_thread_row() -> TestResult {
    let directory = tempfile::tempdir()?;
    // An archived parent that is itself a sub-agent of `ROOT`.
    let archived = directory.path().join("archived_sessions");
    std::fs::create_dir_all(&archived)?;
    let parent_path = archived.join(format!("rollout-2026-10-12T00-00-00-{PARENT}.jsonl"));
    let parent_header = json!({"type": "session_meta", "payload": {"id": PARENT, "cwd": "/parent",
        "source": {"subagent": {"thread_spawn": {"parent_thread_id": ROOT}}}}});
    append(&parent_path, std::slice::from_ref(&parent_header))?;
    append(&parent_path, &completed_turns(&["p0"]))?;
    // Its child copies the parent's header verbatim into a live rollout.
    let child_path = rollout_path(directory.path(), CHILD)?;
    append(
        &child_path,
        &[child_header(
            &json!({"forked_from_id": PARENT, "cwd": "/child",
        "subagent_history_start_ordinal": 2}),
        )],
    )?;
    append(&child_path, &[parent_header])?;
    append(&child_path, &completed_turns(&["c0"]))?;
    let service = service(directory.path())?;

    crate::rollout::index_rollout_fully(&service.store, &parent_path)?;
    crate::rollout::index_rollout_fully(&service.store, &child_path)?;

    let rows = service.store.threads().thread_descendants(ROOT)?;
    let summary = rows
        .iter()
        .map(|row| (row.id.as_str(), row.archived, row.cwd.as_str()))
        .collect::<Vec<_>>();
    assert_eq!(
        summary,
        [(PARENT, true, "/parent"), (CHILD, false, "/child")]
    );
    Ok(())
}

/// A client that missed a child's terminal event retires its stale running
/// state only from the tree snapshot, so the snapshot answers from the rollout.
#[tokio::test]
async fn the_subagent_tree_reports_each_child_turn_state_from_its_rollout() -> TestResult {
    const RUNNING: &str = "019fe7af-1000-7000-8000-000000000011";
    let directory = tempfile::tempdir()?;
    let finished_path = rollout_path(directory.path(), CHILD)?;
    append(&finished_path, &[child_header(&json!({}))])?;
    append(&finished_path, &completed_turns(&["c0"]))?;
    // A background command of the finished turn that settles after it.
    append(
        &finished_path,
        &[event(&json!({"type": "item_completed", "turn_id": "c0",
            "item": {"type": "CommandExecution", "id": "exec-late", "status": "failed"}}))],
    )?;
    let running_path = rollout_path(directory.path(), RUNNING)?;
    let mut running_header = child_header(&json!({}));
    running_header["payload"]["id"] = json!(RUNNING);
    append(&running_path, &[running_header])?;
    append(&running_path, &completed_turns(&["r0"]))?;
    append(
        &running_path,
        &[event(&json!({"type": "task_started", "turn_id": "r1"}))],
    )?;
    let service = service(directory.path())?;
    crate::rollout::index_rollout_fully(&service.store, &finished_path)?;
    crate::rollout::index_rollout_fully(&service.store, &running_path)?;

    let tree = service
        .subagent_descendants(&json!({"threadId": PARENT}))
        .await?;
    let mut states = tree["threads"]
        .as_array()
        .ok_or("the tree lists threads")?
        .iter()
        .map(|thread| (thread["id"].clone(), thread["running"].clone()))
        .collect::<Vec<_>>();
    states.sort_by_key(|(id, _)| id.to_string());
    assert_eq!(
        states,
        [(json!(CHILD), json!(false)), (json!(RUNNING), json!(true))]
    );
    Ok(())
}
