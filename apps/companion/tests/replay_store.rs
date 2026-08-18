use codewide_companion::store::IndexStore;
use tempfile::tempdir;

#[test]
fn replay_tail_is_bounded_and_survives_restart() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempdir()?;
    let path = directory.path().join("state.redb");
    {
        let store = IndexStore::open(&path)?;
        let cursors = store.append_replay_batch(
            &[
                br#"{"method":"one"}"#.to_vec(),
                br#"{"method":"two"}"#.to_vec(),
            ],
            2,
            1024,
        )?;
        assert_eq!(cursors, [1, 2]);
        assert_eq!(
            store.append_replay_batch(&[br#"{"method":"three"}"#.to_vec()], 2, 1024)?,
            [3]
        );
    }

    let reopened = IndexStore::open(&path)?;
    let evicted = reopened.replay_after(Some(0))?;
    assert!(evicted.snapshot_required);
    assert_eq!(evicted.head_cursor, 3);

    let retained = reopened.replay_after(Some(1))?;
    assert!(!retained.snapshot_required);
    assert_eq!(
        retained
            .entries
            .iter()
            .map(|(cursor, _payload)| *cursor)
            .collect::<Vec<_>>(),
        [2, 3]
    );
    assert!(reopened.replay_after(Some(3))?.entries.is_empty());
    Ok(())
}

#[test]
fn replay_eviction_honors_byte_budget() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempdir()?;
    let store = IndexStore::open(directory.path().join("state.redb"))?;
    store.append_replay_batch(&[vec![1; 8], vec![2; 8], vec![3; 8]], 100, 16)?;
    assert!(store.replay_after(Some(0))?.snapshot_required);
    assert_eq!(store.replay_after(Some(1))?.entries.len(), 2);
    Ok(())
}
