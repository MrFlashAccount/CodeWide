use std::{fs, io::Write};

use codewide_companion::{
    rollout::{index_rollout, rollout_file_id, scan_tail_turns},
    store::IndexStore,
};

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
