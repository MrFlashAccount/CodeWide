use std::{fs, io::Write};

use codewide_companion::{
    rollout::{
        backfill_rollout_prefix, index_rollout, index_rollout_fully, rollout_file_id,
        scan_tail_turns,
    },
    store::IndexStore,
};
use redb::{Database, TableDefinition};
use serde_json::Value;

#[test]
fn indexes_only_complete_jsonl_records() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let mut rollout = fs::File::create(&rollout_path)?;
    writeln!(rollout, r#"{{"type":"session_meta","payload":{{}}}}"#)?;
    writeln!(rollout, r#"{{"type":"turn_context","payload":{{}}}}"#)?;
    write!(rollout, r#"{{"type":"response_item","payload":{{}}}}"#)?;
    rollout.sync_all()?;

    let store = IndexStore::open(directory.path().join("index.redb"))?;
    let report = index_rollout(&store, &rollout_path)?;

    assert_eq!(report.indexed_records, 2);
    assert_eq!(report.total_records, 2);
    assert_eq!(store.record_count()?, 2);

    let mut rollout = fs::OpenOptions::new().append(true).open(&rollout_path)?;
    writeln!(rollout)?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"turn"}}}}"#
    )?;
    rollout.sync_all()?;

    let appended = index_rollout(&store, &rollout_path)?;
    assert_eq!(appended.indexed_records, 2);
    assert_eq!(appended.total_records, 4);
    assert_eq!(store.record_count()?, 4);

    let warm = index_rollout(&store, &rollout_path)?;
    assert_eq!(warm.indexed_records, 0);
    assert_eq!(warm.total_records, 4);
    Ok(())
}

#[test]
fn indexes_turn_boundaries_and_supports_descending_pages() -> Result<(), Box<dyn std::error::Error>>
{
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let mut rollout = fs::File::create(&rollout_path)?;
    write_turn(&mut rollout, "turn-1", true)?;
    write_turn(&mut rollout, "turn-2", true)?;
    write_turn(&mut rollout, "turn-3", false)?;
    rollout.sync_all()?;

    let store = IndexStore::open(directory.path().join("index.redb"))?;
    let report = index_rollout(&store, &rollout_path)?;
    let file_id = rollout_file_id(&rollout_path);
    assert_eq!(report.total_turns, 3);
    assert_eq!(store.turn_count()?, 3);

    let latest = store.turns_desc(&file_id, None, 2)?;
    assert_eq!(
        latest
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["turn-3", "turn-2"]
    );
    assert!(!latest[0].completed);
    assert!(latest[1].completed);
    let older = store.turns_desc(&file_id, Some(latest[1].start_offset), 2)?;
    assert_eq!(older[0].id, "turn-1");
    assert_eq!(
        store.turn_by_id(&file_id, "turn-2")?,
        Some(latest[1].clone())
    );
    assert_eq!(store.turn_by_id(&file_id, "missing")?, None);
    Ok(())
}

#[test]
fn materializes_and_incrementally_advances_the_active_turn_summary()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let mut rollout = fs::File::create(&rollout_path)?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"turn"}}}}"#
    )?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"agent_message","message":"partial","phase":"commentary"}}}}"#
    )?;
    rollout.sync_all()?;

    let store = IndexStore::open(directory.path().join("index.redb"))?;
    index_rollout(&store, &rollout_path)?;
    let file_id = rollout_file_id(&rollout_path);
    let turn = store.turn_by_id(&file_id, "turn")?.ok_or("turn missing")?;
    let partial: Value = store
        .turn_summary_state(&file_id, turn.start_offset)?
        .ok_or("summary missing")?;
    assert_eq!(partial["fallback_agent"], "partial");

    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"agent_message","message":"final","phase":"final_answer"}}}}"#
    )?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"turn","last_agent_message":"final"}}}}"#
    )?;
    rollout.sync_all()?;
    let report = index_rollout(&store, &rollout_path)?;
    let completed: Value = store
        .turn_summary_state(&file_id, turn.start_offset)?
        .ok_or("completed summary missing")?;

    assert_eq!(report.indexed_records, 2);
    assert_eq!(completed["fallback_agent"], "final");
    assert_eq!(completed["digest"]["status"], "completed");
    Ok(())
}

#[test]
fn cold_tail_scan_finds_latest_page_without_an_index() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let mut rollout = fs::File::create(&rollout_path)?;
    write_turn(&mut rollout, "turn-1", true)?;
    writeln!(
        rollout,
        "{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"text\":\"{}\"}}}}",
        "x".repeat(1024 * 1024)
    )?;
    write_turn(&mut rollout, "turn-2", true)?;
    write_turn(&mut rollout, "turn-3", true)?;
    write!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"incomplete"}}}}"#
    )?;
    rollout.sync_all()?;

    let latest = scan_tail_turns(&rollout_path, None, 2)?;
    assert_eq!(
        latest
            .turns
            .iter()
            .map(|turn| turn.id.as_str())
            .collect::<Vec<_>>(),
        ["turn-3", "turn-2"]
    );
    assert!(latest.durable_bytes < latest.file_bytes);
    assert!(latest.bytes_scanned < latest.file_bytes);

    let older = scan_tail_turns(
        &rollout_path,
        latest.turns.last().map(|turn| turn.start_offset),
        2,
    )?;
    assert_eq!(older.turns[0].id, "turn-1");
    Ok(())
}

#[test]
fn large_cold_index_serves_the_tail_then_backfills_the_prefix()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let mut rollout = fs::File::create(&rollout_path)?;
    write_turn(&mut rollout, "old-before-padding", true)?;
    writeln!(
        rollout,
        "{{\"type\":\"compacted\",\"payload\":{{\"opaque\":\"{}\"}}}}",
        "x".repeat(9 * 1024 * 1024)
    )?;
    for index in 0..70 {
        write_turn(&mut rollout, &format!("tail-{index}"), true)?;
    }
    rollout.sync_all()?;

    let store_path = directory.path().join("index.redb");
    let store = IndexStore::open(&store_path)?;
    let hot = index_rollout(&store, &rollout_path)?;
    let file_id = rollout_file_id(&rollout_path);
    let state = store.file_state(&file_id)?.ok_or("file state missing")?;

    assert!(!hot.complete);
    assert!(hot.coverage_start > 0);
    assert_eq!(state.indexed_from, hot.coverage_start);
    assert_eq!(state.indexed_bytes, rollout.metadata()?.len());
    assert_eq!(store.turns_desc(&file_id, None, 1)?[0].id, "tail-69");
    assert_eq!(store.turn_count()?, 1);
    assert!(store.record_count()? < 70 * 4);

    drop(store);
    let reopened = IndexStore::open(&store_path)?;
    let warm = index_rollout(&reopened, &rollout_path)?;
    assert_eq!(warm.indexed_records, 0);
    assert!(!warm.complete);

    write_turn(&mut rollout, "appended-before-backfill", true)?;
    rollout.sync_all()?;
    let appended = index_rollout(&reopened, &rollout_path)?;
    assert_eq!(appended.indexed_records, 4);
    assert!(!appended.complete);
    assert_eq!(
        reopened.turns_desc(&file_id, None, 1)?[0].id,
        "appended-before-backfill"
    );

    let first_backfill = backfill_rollout_prefix(&reopened, &rollout_path)?;
    assert!(first_backfill.coverage_start < hot.coverage_start);
    let complete = index_rollout_fully(&reopened, &rollout_path)?;
    let complete_state = reopened
        .file_state(&file_id)?
        .ok_or("complete file state missing")?;
    assert!(complete.complete);
    assert!(complete_state.is_complete());
    assert_eq!(complete_state.indexed_from, 0);
    assert_eq!(reopened.turn_count()?, 72);
    assert_eq!(reopened.record_count()?, 72 * 4 + 1);
    Ok(())
}

#[test]
fn rebuilds_derived_index_after_rollout_replacement() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let store = IndexStore::open(directory.path().join("index.redb"))?;
    {
        let mut rollout = fs::File::create(&rollout_path)?;
        write_turn(&mut rollout, "old-1", true)?;
        write_turn(&mut rollout, "old-2", true)?;
        rollout.sync_all()?;
    }
    index_rollout(&store, &rollout_path)?;
    assert_eq!(store.turn_count()?, 2);

    {
        let mut rollout = fs::File::create(&rollout_path)?;
        write_turn(&mut rollout, "new-1", true)?;
        rollout.sync_all()?;
    }
    let rebuilt = index_rollout(&store, &rollout_path)?;
    let file_id = rollout_file_id(&rollout_path);
    assert_eq!(rebuilt.total_turns, 1);
    assert_eq!(store.turn_count()?, 1);
    assert_eq!(store.turns_desc(&file_id, None, 10)?[0].id, "new-1");
    Ok(())
}

#[test]
fn replaces_a_partial_tail_index_after_truncation() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let store = IndexStore::open(directory.path().join("index.redb"))?;
    {
        let mut rollout = fs::File::create(&rollout_path)?;
        writeln!(
            rollout,
            "{{\"type\":\"compacted\",\"payload\":{{\"opaque\":\"{}\"}}}}",
            "x".repeat(9 * 1024 * 1024)
        )?;
        write_turn(&mut rollout, "old-tail", true)?;
        rollout.sync_all()?;
    }
    let partial = index_rollout(&store, &rollout_path)?;
    assert!(!partial.complete);

    {
        let mut rollout = fs::File::create(&rollout_path)?;
        write_turn(&mut rollout, "replacement", true)?;
        rollout.sync_all()?;
    }
    let rebuilt = index_rollout(&store, &rollout_path)?;
    let file_id = rollout_file_id(&rollout_path);

    assert!(rebuilt.complete);
    assert_eq!(store.turn_count()?, 1);
    assert_eq!(store.turns_desc(&file_id, None, 10)?[0].id, "replacement");
    Ok(())
}

#[test]
fn aborted_turn_is_closed_at_its_terminal_record() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let mut rollout = fs::File::create(&rollout_path)?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"turn-aborted"}}}}"#
    )?;
    writeln!(
        rollout,
        r#"{{"type":"response_item","payload":{{"type":"message","role":"assistant","content":[]}}}}"#
    )?;
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"turn_aborted","turn_id":"turn-aborted"}}}}"#
    )?;
    rollout.sync_all()?;

    let store = IndexStore::open(directory.path().join("index.redb"))?;
    index_rollout(&store, &rollout_path)?;
    let file_id = rollout_file_id(&rollout_path);
    let turn = store
        .turn_by_id(&file_id, "turn-aborted")?
        .ok_or("aborted turn was not indexed")?;

    assert!(turn.end_offset > turn.start_offset);
    assert_eq!(turn.end_offset, rollout.metadata()?.len());
    assert!(!turn.completed);
    Ok(())
}

#[test]
fn schema_upgrade_rebuilds_only_derived_rollout_tables() -> Result<(), Box<dyn std::error::Error>> {
    const META: TableDefinition<&str, u64> = TableDefinition::new("meta");

    let directory = tempfile::tempdir()?;
    let rollout_path = directory.path().join("rollout.jsonl");
    let state_path = directory.path().join("state.redb");
    let mut rollout = fs::File::create(&rollout_path)?;
    write_turn(&mut rollout, "turn-1", true)?;
    rollout.sync_all()?;
    {
        let store = IndexStore::open(&state_path)?;
        index_rollout(&store, &rollout_path)?;
        store.append_replay_batch(&[br#"{"method":"kept"}"#.to_vec()], 8, 1024)?;
        assert_eq!(store.turn_count()?, 1);
    }
    {
        let database = Database::create(&state_path)?;
        let write = database.begin_write()?;
        write.open_table(META)?.insert("schema_version", 4)?;
        write.commit()?;
    }

    let migrated = IndexStore::open(&state_path)?;
    assert_eq!(migrated.schema_version(), 7);
    assert_eq!(migrated.turn_count()?, 0);
    assert_eq!(migrated.replay_after(Some(0))?.entries.len(), 1);
    Ok(())
}

fn write_turn(
    rollout: &mut fs::File,
    turn_id: &str,
    completed: bool,
) -> Result<(), std::io::Error> {
    writeln!(
        rollout,
        r#"{{"type":"event_msg","payload":{{"type":"task_started","turn_id":"{turn_id}"}}}}"#
    )?;
    writeln!(
        rollout,
        r#"{{"type":"turn_context","payload":{{"turn_id":"{turn_id}"}}}}"#
    )?;
    writeln!(
        rollout,
        r#"{{"type":"response_item","payload":{{"type":"message","role":"user","content":[]}}}}"#
    )?;
    if completed {
        writeln!(
            rollout,
            r#"{{"type":"event_msg","payload":{{"type":"task_complete","turn_id":"{turn_id}"}}}}"#
        )?;
    }
    Ok(())
}
