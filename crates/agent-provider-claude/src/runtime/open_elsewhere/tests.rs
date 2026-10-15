//! [`OpenElsewhere`] over a scripted running-sessions source on paused
//! tokio time.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use async_trait::async_trait;

use super::*;
use crate::runtime::running_sessions::RunningSessionsError;

const POLL: Duration = Duration::from_secs(10);
const OTHER: &str = "terminal-session";
const OWN: &str = "own-session";

/// What `claude agents --json` would list, scripted by the test.
#[derive(Default)]
struct Scripted {
    listed: Mutex<HashSet<String>>,
    fail: AtomicBool,
    reads: AtomicUsize,
    /// How long one list takes.
    delay: Mutex<Duration>,
}

impl Scripted {
    fn set(&self, sessions: &[&str]) {
        *self.listed.lock().unwrap_or_else(PoisonError::into_inner) = sessions
            .iter()
            .map(|session| (*session).to_owned())
            .collect();
    }

    fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl RunningSessions for Scripted {
    async fn list(&self) -> Result<HashSet<String>, RunningSessionsError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let delay = *self.delay.lock().unwrap_or_else(PoisonError::into_inner);
        if !delay.is_zero() {
            tokio::time::sleep(delay).await;
        }
        if self.fail.load(Ordering::SeqCst) {
            return Err(RunningSessionsError::NotAnArray);
        }
        Ok(self
            .listed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone())
    }
}

struct Harness {
    owner: OpenElsewhere,
    source: Arc<Scripted>,
    live: Arc<Mutex<HashSet<String>>>,
    changes: Arc<Mutex<Vec<Vec<String>>>>,
}

impl Harness {
    fn new() -> Self {
        let source = Arc::new(Scripted::default());
        let live = Arc::new(Mutex::new(HashSet::new()));
        let changes = Arc::new(Mutex::new(Vec::new()));
        let owns = live.clone();
        let recorder = changes.clone();
        let owner = OpenElsewhere::new(OpenElsewhereDeps {
            running: source.clone(),
            owns_live: Arc::new(move |session_id| {
                owns.lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .contains(session_id)
            }),
            changed: Arc::new(move |sessions| {
                let mut sessions: Vec<String> = sessions.iter().cloned().collect();
                sessions.sort();
                recorder
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(sessions);
            }),
            poll: POLL,
        });
        Self {
            owner,
            source,
            live,
            changes,
        }
    }

    fn changes(&self) -> Vec<Vec<String>> {
        self.changes
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn run_live(&self, session_id: &str) {
        self.live
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(session_id.to_owned());
    }

    fn end_live(&self, session_id: &str) {
        self.live
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(session_id);
        self.owner.released(session_id);
    }
}

fn sessions(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|id| (*id).to_owned()).collect()
}

#[tokio::test(start_paused = true)]
async fn a_session_another_process_runs_is_held_and_its_release_is_polled() {
    let harness = Harness::new();
    assert!(!harness.owner.is_held(OTHER));
    harness.source.set(&[OTHER]);
    assert!(harness.owner.check(OTHER).await);
    assert_eq!(harness.changes(), [sessions(&[OTHER])]);

    harness.source.set(&[]);
    // No new read is asked for: the poll brings the release.
    tokio::time::sleep(POLL + Duration::from_millis(1)).await;
    assert!(!harness.owner.is_held(OTHER));
    assert_eq!(harness.changes(), [sessions(&[OTHER]), sessions(&[OTHER])]);

    // Nothing is held, so nothing polls any more.
    let reads = harness.source.reads();
    tokio::time::sleep(POLL * 3).await;
    assert_eq!(harness.source.reads(), reads);
}

#[tokio::test(start_paused = true)]
async fn the_session_of_an_own_live_process_is_not_held() {
    let harness = Harness::new();
    harness.run_live(OWN);
    harness.source.set(&[OWN]);
    assert!(!harness.owner.check(OWN).await);
    assert!(harness.changes().is_empty());
    let reads = harness.source.reads();
    tokio::time::sleep(POLL * 2).await;
    assert_eq!(
        harness.source.reads(),
        reads,
        "nothing held, nothing polled"
    );
}

#[tokio::test(start_paused = true)]
async fn an_own_just_released_process_is_not_taken_for_another() {
    let harness = Harness::new();
    tokio::time::sleep(Duration::from_mins(1)).await;
    harness.run_live(OWN);
    // The CLI lists the companion's own process while it runs.
    harness.source.set(&[OWN]);
    assert!(!harness.owner.check(OWN).await);
    // A model change closes the process; the CLI may list it a while longer.
    harness.end_live(OWN);
    assert!(!harness.owner.is_held(OWN));
    tokio::time::sleep(MAX_AGE).await;
    assert!(!harness.owner.check(OWN).await, "a read within the grace");
    assert!(harness.changes().is_empty());

    // Still listed after the grace: another process holds it now.
    tokio::time::sleep(RELEASE_GRACE).await;
    assert!(harness.owner.check(OWN).await);
    assert_eq!(harness.changes(), [sessions(&[OWN])]);
}

#[tokio::test(start_paused = true)]
async fn a_release_hides_a_read_that_started_before_it() {
    let harness = Harness::new();
    tokio::time::sleep(Duration::from_mins(1)).await;
    harness.source.set(&[OWN]);
    *harness
        .source
        .delay
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Duration::from_secs(1);
    let owner = &harness.owner;
    let (held, ()) = tokio::join!(owner.check(OWN), async {
        tokio::time::sleep(Duration::from_millis(500)).await;
        owner.released(OWN);
    });
    assert!(!held);
}

#[tokio::test(start_paused = true)]
async fn a_fresh_read_is_reused_and_concurrent_reads_share_one() {
    let harness = Harness::new();
    harness.source.set(&[OTHER]);
    *harness
        .source
        .delay
        .lock()
        .unwrap_or_else(PoisonError::into_inner) = Duration::from_millis(100);
    let owner = &harness.owner;
    let (first, second) = tokio::join!(owner.check(OTHER), owner.check(OTHER));
    assert!(first && second);
    assert_eq!(harness.source.reads(), 1);
    assert!(owner.check(OTHER).await);
    assert_eq!(harness.source.reads(), 1, "younger than the maximum age");
    tokio::time::sleep(MAX_AGE).await;
    assert!(owner.check(OTHER).await);
    assert_eq!(harness.source.reads(), 2);
    assert_eq!(harness.changes(), [sessions(&[OTHER])]);
}

#[tokio::test(start_paused = true)]
async fn a_failed_read_keeps_the_last_known_set() {
    let harness = Harness::new();
    harness.source.set(&[OTHER]);
    assert!(harness.owner.check(OTHER).await);
    harness.source.fail.store(true, Ordering::SeqCst);
    harness.source.set(&[]);
    tokio::time::sleep(MAX_AGE).await;
    assert!(harness.owner.check(OTHER).await);
    assert_eq!(harness.changes(), [sessions(&[OTHER])]);
}

#[tokio::test(start_paused = true)]
async fn a_background_refresh_reports_through_the_change_callback() {
    let harness = Harness::new();
    harness.source.set(&[OTHER]);
    harness.owner.refresh_in_background();
    tokio::time::sleep(Duration::from_millis(1)).await;
    assert!(harness.owner.is_held(OTHER));
    assert_eq!(harness.changes(), [sessions(&[OTHER])]);
}

#[tokio::test(start_paused = true)]
async fn shutdown_stops_the_polling() {
    let harness = Harness::new();
    harness.source.set(&[OTHER]);
    assert!(harness.owner.check(OTHER).await);
    harness.owner.shutdown();
    let reads = harness.source.reads();
    tokio::time::sleep(POLL * 3).await;
    assert_eq!(harness.source.reads(), reads);
}
