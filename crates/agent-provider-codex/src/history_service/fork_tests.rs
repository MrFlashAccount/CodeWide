//! A paginated fork's history continues into the history it inherited from its
//! base thread, which Codex leaves in the base thread's rollout.

use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::{Value, json};

use super::{HistoryService, HistoryServiceError};
use crate::catalog::SessionCatalog;

type TestResult = Result<(), Box<dyn std::error::Error>>;

const PARENT: &str = "019fe7af-0000-7000-8000-000000000001";
const FORK: &str = "019fe7af-0000-7000-8000-000000000002";
const NESTED_FORK: &str = "019fe7af-0000-7000-8000-000000000003";
const MISSING: &str = "019fe7af-0000-7000-8000-0000000000ff";

fn service(root: &Path) -> Result<HistoryService, Box<dyn std::error::Error>> {
    Ok(HistoryService::new(
        Arc::new(SessionCatalog::scan(root)),
        Arc::new(crate::test_support::open_rollout_store(
            root.join("history-index.redb"),
        )?),
    ))
}

fn rollout_path(root: &Path, thread_id: &str) -> std::io::Result<PathBuf> {
    let sessions = root.join("sessions/2026/10/12");
    std::fs::create_dir_all(&sessions)?;
    Ok(sessions.join(format!("rollout-2026-10-12T00-00-00-{thread_id}.jsonl")))
}

fn append(path: &Path, records: &[Value]) -> std::io::Result<u64> {
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    for record in records {
        writeln!(file, "{record}")?;
    }
    file.sync_all()?;
    Ok(std::fs::metadata(path)?.len())
}

fn session_meta(thread_id: &str, base: Option<(&str, u64)>) -> Value {
    let mut payload = json!({"id": thread_id, "history_mode": "paginated"});
    if let Some((base_thread_id, end_byte_offset)) = base {
        payload["forked_from_id"] = json!(base_thread_id);
        payload["history_base"] =
            json!({"thread_id": base_thread_id, "end_byte_offset": end_byte_offset});
    }
    json!({"type": "session_meta", "payload": payload})
}

fn event(payload: &Value) -> Value {
    json!({"type": "event_msg", "payload": payload})
}

fn completed_turn(id: &str) -> Vec<Value> {
    vec![
        event(&json!({"type": "task_started", "turn_id": id})),
        event(&json!({"type": "user_message", "message": format!("question {id}")})),
        event(
            &json!({"type": "agent_message", "message": format!("answer {id}"), "phase": "final_answer"}),
        ),
        event(
            &json!({"type": "task_complete", "turn_id": id, "last_agent_message": format!("answer {id}")}),
        ),
    ]
}

fn completed_turns(ids: &[&str]) -> Vec<Value> {
    ids.iter().flat_map(|id| completed_turn(id)).collect()
}

/// A base thread forked while its turn `p5` was running: the fork inherits
/// `p0`..`p4` and the start of `p5`. Returns the fork point.
fn write_parent_forked_mid_turn(root: &Path) -> Result<u64, Box<dyn std::error::Error>> {
    let parent = rollout_path(root, PARENT)?;
    append(&parent, &[session_meta(PARENT, None)])?;
    append(&parent, &completed_turns(&["p0", "p1", "p2", "p3", "p4"]))?;
    let fork_point = append(
        &parent,
        &[
            event(&json!({"type": "task_started", "turn_id": "p5"})),
            event(&json!({"type": "user_message", "message": "cut question"})),
        ],
    )?;
    // The base thread goes on after the fork; none of this is inherited.
    append(
        &parent,
        &[
            event(
                &json!({"type": "agent_message", "message": "parent-only answer", "phase": "final_answer"}),
            ),
            event(
                &json!({"type": "task_complete", "turn_id": "p5", "last_agent_message": "parent-only answer"}),
            ),
        ],
    )?;
    append(&parent, &completed_turn("p6"))?;
    Ok(fork_point)
}

fn write_fork(
    root: &Path,
    base: (&str, u64),
    turns: &[&str],
) -> Result<u64, Box<dyn std::error::Error>> {
    write_thread(root, FORK, base, turns)
}

fn write_thread(
    root: &Path,
    thread_id: &str,
    base: (&str, u64),
    turns: &[&str],
) -> Result<u64, Box<dyn std::error::Error>> {
    let path = rollout_path(root, thread_id)?;
    append(&path, &[session_meta(thread_id, Some(base))])?;
    Ok(append(&path, &completed_turns(turns))?)
}

fn ids(turns: &Value) -> Vec<&str> {
    turns
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|turn| turn["id"].as_str())
        .collect()
}

fn turn<'a>(turns: &'a Value, id: &str) -> Option<&'a Value> {
    turns.as_array()?.iter().find(|turn| turn["id"] == id)
}

/// Every turn of `thread_id`, newest first, through `thread/turns/list` pages.
async fn all_pages(
    service: &HistoryService,
    thread_id: &str,
    limit: usize,
) -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let mut pages = Vec::new();
    let mut cursor = Value::Null;
    loop {
        let params = json!({"threadId": thread_id, "cursor": cursor, "limit": limit,
            "sortDirection": "desc", "itemsView": "summary"});
        let page = service
            .try_turns_page("thread/turns/list", &params)
            .await
            .ok_or("turn page was not handled")??;
        cursor = page["nextCursor"].clone();
        pages.push(page);
        if cursor.is_null() {
            return Ok(pages);
        }
        if pages.len() > 20 {
            return Err("turn pages do not end".into());
        }
    }
}

fn page_ids(pages: &[Value]) -> Vec<Vec<&str>> {
    pages.iter().map(|page| ids(&page["data"])).collect()
}

#[tokio::test]
async fn turn_pages_continue_into_the_inherited_history() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &["f0", "f1", "f2"])?;
    let service = service(directory.path())?;

    let pages = all_pages(&service, FORK, 4).await?;

    assert_eq!(
        page_ids(&pages),
        [
            vec!["f2", "f1", "f0", "p5"],
            vec!["p4", "p3", "p2", "p1"],
            vec!["p0"]
        ]
    );
    let cut = turn(&pages[0]["data"], "p5").ok_or("cut turn missing")?;
    assert_eq!(cut["status"], "interrupted");
    assert!(!cut.to_string().contains("parent-only answer"));
    assert_eq!(
        turn(&pages[1]["data"], "p4").map(|turn| &turn["status"]),
        Some(&json!("completed"))
    );
    // The base thread's own history is unchanged and still continues past the fork.
    let parent = all_pages(&service, PARENT, 10).await?;
    assert_eq!(
        page_ids(&parent),
        [vec!["p6", "p5", "p4", "p3", "p2", "p1", "p0"]]
    );
    assert_eq!(
        turn(&parent[0]["data"], "p5").map(|turn| &turn["status"]),
        Some(&json!("completed"))
    );
    Ok(())
}

#[tokio::test]
async fn older_pages_cross_the_fork_point_by_anchor() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &["f0", "f1"])?;
    let service = service(directory.path())?;

    let crossing = service
        .turns_before(&json!({"threadId": FORK, "beforeTurnId": "f0", "limit": 3}))
        .await?;
    assert_eq!(ids(&crossing["data"]), ["p3", "p4", "p5"]);
    assert_eq!(crossing["hasMore"], true);

    let inherited = service
        .turns_before(&json!({"threadId": FORK, "beforeTurnId": "p3", "limit": 5}))
        .await?;
    assert_eq!(ids(&inherited["data"]), ["p0", "p1", "p2"]);
    assert_eq!(inherited["hasMore"], false);

    // The base thread's later turn is not part of the fork's history.
    assert!(matches!(
        service
            .turns_before(&json!({"threadId": FORK, "beforeTurnId": "p6", "limit": 5}))
            .await,
        Err(HistoryServiceError::InvalidCursor)
    ));
    Ok(())
}

#[tokio::test]
async fn history_reset_includes_inherited_turns_and_an_older_cursor() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &["f0", "f1", "f2"])?;
    let service = service(directory.path())?;

    let reset = service.sync_thread_history(FORK, None, 4, None).await?;
    assert_eq!(reset["kind"], "reset");
    assert_eq!(ids(&reset["turns"]), ["p5", "f0", "f1", "f2"]);
    assert_eq!(reset["headTurnId"], "f2");

    let older = service
        .try_turns_page(
            "thread/turns/list",
            &json!({"threadId": FORK, "cursor": reset["olderCursor"], "limit": 10,
                "sortDirection": "desc", "itemsView": "summary"}),
        )
        .await
        .ok_or("turn page was not handled")??;
    assert_eq!(ids(&older["data"]), ["p4", "p3", "p2", "p1", "p0"]);
    assert!(older["nextCursor"].is_null());

    let complete = service.sync_thread_history(FORK, None, 20, None).await?;
    assert_eq!(
        ids(&complete["turns"]),
        ["p0", "p1", "p2", "p3", "p4", "p5", "f0", "f1", "f2"]
    );
    assert!(complete["olderCursor"].is_null());
    Ok(())
}

#[tokio::test]
async fn a_rollback_in_the_base_thread_after_the_fork_keeps_the_inherited_turns() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &["f0"])?;
    let service = service(directory.path())?;
    // Index the base thread before and after its rollback, as its own reads do.
    service.sync_thread_history(PARENT, None, 10, None).await?;
    append(
        &rollout_path(directory.path(), PARENT)?,
        &[event(
            &json!({"type": "thread_rolled_back", "num_turns": 3}),
        )],
    )?;
    let parent = all_pages(&service, PARENT, 10).await?;
    assert_eq!(page_ids(&parent), [vec!["p3", "p2", "p1", "p0"]]);

    let fork = all_pages(&service, FORK, 3).await?;

    assert_eq!(
        page_ids(&fork),
        [vec!["f0", "p5", "p4"], vec!["p3", "p2", "p1"], vec!["p0"]]
    );
    Ok(())
}

#[tokio::test]
async fn a_fork_of_a_fork_inherits_both_bases() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    let nested_point = write_fork(directory.path(), (PARENT, fork_point), &["f0", "f1"])?;
    // The fork goes on after it was forked again.
    append(
        &rollout_path(directory.path(), FORK)?,
        &completed_turn("f2"),
    )?;
    write_thread(directory.path(), NESTED_FORK, (FORK, nested_point), &["n0"])?;
    let service = service(directory.path())?;

    let pages = all_pages(&service, NESTED_FORK, 3).await?;

    assert_eq!(
        page_ids(&pages),
        [
            vec!["n0", "f1", "f0"],
            vec!["p5", "p4", "p3"],
            vec!["p2", "p1", "p0"]
        ]
    );
    Ok(())
}

#[tokio::test]
async fn a_missing_base_leaves_the_fork_history_readable() -> TestResult {
    let directory = tempfile::tempdir()?;
    write_fork(directory.path(), (MISSING, 1_000), &["f0", "f1"])?;
    let service = service(directory.path())?;

    let pages = all_pages(&service, FORK, 10).await?;

    assert_eq!(page_ids(&pages), [vec!["f1", "f0"]]);
    let reset = service.sync_thread_history(FORK, None, 10, None).await?;
    assert_eq!(ids(&reset["turns"]), ["f0", "f1"]);
    assert!(reset["olderCursor"].is_null());
    Ok(())
}

#[tokio::test]
async fn a_fork_without_turns_of_its_own_previews_the_inherited_history() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &[])?;
    let service = service(directory.path())?;

    let thread = service.enrich_thread(json!({"id": FORK})).await;

    assert_eq!(thread["preview"], "cut question");
    assert!(!service.thread_active(FORK).await?);
    Ok(())
}

const REVERTED_ROLLOUT: &str = "019fe7af-0000-7000-8000-000000000004";

/// `thread/revert` keeps the thread id and writes a new rollout
/// `<thread>_<rollout>.jsonl` whose `history_base` names the thread's earlier
/// rollout by rollout id, which for a first rollout equals the thread id.
fn write_reverted_parent(root: &Path) -> Result<u64, Box<dyn std::error::Error>> {
    let first = rollout_path(root, PARENT)?;
    append(&first, &[session_meta(PARENT, None)])?;
    let kept = append(&first, &completed_turns(&["p0", "p1", "p2"]))?;
    append(&first, &completed_turns(&["p3", "p4"]))?;
    let sessions = first.parent().ok_or("rollout directory")?;
    let reverted = sessions.join(format!(
        "rollout-2026-10-12T00-00-01-{PARENT}_{REVERTED_ROLLOUT}.jsonl"
    ));
    append(&reverted, &[session_meta(PARENT, Some((PARENT, kept)))])?;
    Ok(append(&reverted, &completed_turns(&["r0"]))?)
}

#[tokio::test]
async fn a_reverted_thread_continues_its_earlier_rollout() -> TestResult {
    let directory = tempfile::tempdir()?;
    write_reverted_parent(directory.path())?;
    let service = service(directory.path())?;

    let pages = all_pages(&service, PARENT, 10).await?;

    // The thread's own newest rollout names the earlier rollout as its base;
    // resolving that by thread id would find the newest rollout again.
    assert_eq!(page_ids(&pages), [vec!["r0", "p2", "p1", "p0"]]);
    Ok(())
}

#[tokio::test]
async fn a_fork_of_a_reverted_thread_follows_its_rollout_chain() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_reverted_parent(directory.path())?;
    write_fork(directory.path(), (REVERTED_ROLLOUT, fork_point), &["f0"])?;
    let service = service(directory.path())?;

    let pages = all_pages(&service, FORK, 10).await?;

    assert_eq!(page_ids(&pages), [vec!["f0", "r0", "p2", "p1", "p0"]]);
    Ok(())
}

#[tokio::test]
async fn an_unreadable_base_is_an_error_not_the_start_of_the_history() -> TestResult {
    use std::os::unix::fs::PermissionsExt;

    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &["f0"])?;
    let service = service(directory.path())?;
    let parent = rollout_path(directory.path(), PARENT)?;
    std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o000))?;
    if std::fs::File::open(&parent).is_ok() {
        // Running as root: permissions cannot make the base unreadable.
        return Ok(());
    }

    let params = json!({"threadId": FORK, "limit": 10, "sortDirection": "desc",
        "itemsView": "summary"});
    let page = service
        .try_turns_page("thread/turns/list", &params)
        .await
        .ok_or("turn page was not handled")?;

    // A retryable failure must not end the history after the fork's own turns.
    assert!(page.is_err(), "expected an error, got {page:?}");
    std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o644))?;
    let pages = all_pages(&service, FORK, 10).await?;
    assert_eq!(page_ids(&pages)[0][..2], ["f0", "p5"]);
    Ok(())
}

#[tokio::test]
async fn a_client_headed_by_the_fork_point_syncs_without_a_reset() -> TestResult {
    let directory = tempfile::tempdir()?;
    let fork_point = write_parent_forked_mid_turn(directory.path())?;
    write_fork(directory.path(), (PARENT, fork_point), &[])?;
    let service = service(directory.path())?;

    let first = service.sync_thread_history(FORK, None, 10, None).await?;
    assert_eq!(first["kind"], "reset");
    assert_eq!(first["headTurnId"], "p5");

    let idle = service
        .sync_thread_history(FORK, Some("p5"), 10, None)
        .await?;
    assert_eq!(idle["kind"], "current");
    assert_eq!(idle["headTurnId"], "p5");

    // The fork's first own turn arrives as a delta after the inherited head.
    let fork = rollout_path(directory.path(), FORK)?;
    append(&fork, &completed_turns(&["f0"]))?;
    let delta = service
        .sync_thread_history(FORK, Some("p5"), 10, None)
        .await?;
    assert_eq!(delta["kind"], "delta");
    assert_eq!(delta["headTurnId"], "f0");
    assert_eq!(ids(&delta["turns"]), ["f0"]);
    Ok(())
}

/// Pages a real fork's whole history and reports timings. Run with
/// `CODEWIDE_BENCH_CODEX_HOME=~/.codex CODEWIDE_BENCH_THREAD=<id> cargo test -p agent-provider-codex -- --ignored --nocapture bench_real_fork`.
#[tokio::test]
#[ignore = "measures a real Codex home"]
async fn bench_real_fork_history() -> TestResult {
    let (Ok(home), Ok(thread)) = (
        std::env::var("CODEWIDE_BENCH_CODEX_HOME"),
        std::env::var("CODEWIDE_BENCH_THREAD"),
    ) else {
        return Ok(());
    };
    let index = tempfile::tempdir()?;
    let service = HistoryService::new(
        Arc::new(SessionCatalog::scan(Path::new(&home))),
        Arc::new(crate::test_support::open_rollout_store(
            index.path().join("index.redb"),
        )?),
    );
    for pass in ["cold", "warm"] {
        let started = std::time::Instant::now();
        let mut slowest = std::time::Duration::ZERO;
        let mut cursor = Value::Null;
        let (mut pages, mut turns) = (0, 0);
        loop {
            let page_started = std::time::Instant::now();
            let params = json!({"threadId": thread, "cursor": cursor, "limit": 50,
                "sortDirection": "desc", "itemsView": "summary"});
            let page = service
                .try_turns_page("thread/turns/list", &params)
                .await
                .ok_or("turn page was not handled")??;
            slowest = slowest.max(page_started.elapsed());
            pages += 1;
            turns += page["data"].as_array().map_or(0, Vec::len);
            cursor = page["nextCursor"].clone();
            if cursor.is_null() || pages > 10_000 {
                break;
            }
        }
        println!(
            "{pass}: {turns} turns in {pages} pages, total {:?}, slowest page {slowest:?}",
            started.elapsed()
        );
    }
    Ok(())
}
