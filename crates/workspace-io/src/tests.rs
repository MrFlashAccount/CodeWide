use std::{
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

use super::*;

/// One mount that can hang beside the local root.
fn mounts() -> Vec<Mount> {
    vec![
        Mount {
            point: PathBuf::from("/work/arc"),
            fs_type: "fuse.arc".into(),
        },
        Mount {
            point: PathBuf::from("/"),
            fs_type: "ext4".into(),
        },
    ]
}

fn config() -> WorkspaceIoConfig {
    WorkspaceIoConfig {
        deadline: Duration::from_millis(100),
        max_in_flight: 2,
        probe_interval: Duration::from_millis(50),
        max_threads: 16,
    }
}

/// A hung mount: operations on it park until `release`.
#[derive(Clone, Default)]
struct Hang {
    released: Arc<AtomicBool>,
}

impl Hang {
    fn op(&self) -> impl FnOnce() -> io::Result<()> + Send + 'static {
        let released = self.released.clone();
        move || {
            while !released.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(5));
            }
            Ok(())
        }
    }

    fn release(&self) {
        self.released.store(true, Ordering::SeqCst);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_hung_mount_fails_its_own_requests_and_nothing_else() {
    let hang = Hang::default();
    let healthy = Arc::new(AtomicBool::new(false));
    let probe_healthy = healthy.clone();
    let io = WorkspaceIo::with_mount_list(config(), mounts(), move |_| {
        if probe_healthy.load(Ordering::SeqCst) {
            Ok(())
        } else {
            Err(io::Error::other("still hung"))
        }
    });
    let on_hung_mount = Path::new("/work/arc/src/lib.rs");

    let timed_out = io.run(on_hung_mount, hang.op()).await;
    assert!(
        matches!(timed_out, Err(WorkspaceIoError::TimedOut { ref mount, .. }) if mount == Path::new("/work/arc"))
    );

    // The tripped mount fails at once, without running the operation.
    let ran = Arc::new(AtomicUsize::new(0));
    let counted = ran.clone();
    let started = std::time::Instant::now();
    let refused = io
        .run(on_hung_mount, move || {
            counted.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await;
    assert!(matches!(refused, Err(WorkspaceIoError::Unavailable { .. })));
    assert!(started.elapsed() < Duration::from_millis(50));
    assert_eq!(ran.load(Ordering::SeqCst), 0);
    assert!(io.is_unavailable(on_hung_mount));

    // A path on another mount is untouched by the hung one.
    let local = io.run(Path::new("/home/user/file"), || Ok(7)).await;
    assert_eq!(local.ok(), Some(7));

    // The probe brings the mount back once it answers.
    healthy.store(true, Ordering::SeqCst);
    hang.release();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!io.is_unavailable(on_hung_mount));
    assert_eq!(
        io.run(on_hung_mount, || Ok("again")).await.ok(),
        Some("again")
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_mount_cannot_take_more_than_its_share_of_threads() {
    let hang = Hang::default();
    let config = WorkspaceIoConfig {
        deadline: Duration::from_secs(5),
        ..config()
    };
    let io = WorkspaceIo::with_mount_list(config, mounts(), |_| Ok(()));
    let path = Path::new("/work/arc/x");
    let first = tokio::spawn({
        let io = io.clone();
        let op = hang.op();
        async move { io.run(Path::new("/work/arc/x"), op).await }
    });
    let second = tokio::spawn({
        let io = io.clone();
        let op = hang.op();
        async move { io.run(Path::new("/work/arc/y"), op).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let third = io.run(path, || Ok(())).await;
    assert!(matches!(third, Err(WorkspaceIoError::Saturated { .. })));
    hang.release();
    assert!(first.await.is_ok_and(|result| result.is_ok()));
    assert!(second.await.is_ok_and(|result| result.is_ok()));
    assert!(io.run(path, || Ok(())).await.is_ok());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_local_disk_times_out_without_a_breaker() {
    let hang = Hang::default();
    let io = WorkspaceIo::with_mount_list(config(), mounts(), |_| Ok(()));
    let path = Path::new("/home/user/big");
    let timed_out = io.run(path, hang.op()).await;
    assert!(matches!(timed_out, Err(WorkspaceIoError::TimedOut { .. })));
    assert!(!io.is_unavailable(path));
    assert_eq!(io.run(path, || Ok(1)).await.ok(), Some(1));
    hang.release();
}

#[tokio::test]
async fn an_operation_error_passes_through_unchanged() {
    let io = WorkspaceIo::with_mount_list(config(), mounts(), |_| Ok(()));
    let failed = io
        .run(Path::new("/work/arc/missing"), || -> io::Result<()> {
            Err(io::Error::from(io::ErrorKind::NotFound))
        })
        .await;
    let error = io::Error::from(failed.err().unwrap_or(WorkspaceIoError::Saturated {
        mount: PathBuf::new(),
    }));
    assert_eq!(error.kind(), io::ErrorKind::NotFound);
    assert!(!io.is_unavailable(Path::new("/work/arc/missing")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn hung_operations_never_take_the_runtime_blocking_pool() {
    let hang = Hang::default();
    let io = WorkspaceIo::with_mount_list(config(), mounts(), |_| Err(io::Error::other("hung")));
    // Two operations park on the hung mount past their deadline.
    for name in ["a", "b"] {
        let op = hang.op();
        let _ = io.run(&Path::new("/work/arc").join(name), op).await;
    }
    // The runtime's blocking pool still serves the companion's stores.
    let store = tokio::task::spawn_blocking(|| 42).await;
    assert_eq!(store.ok(), Some(42));
    hang.release();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_thread_cap_refuses_instead_of_queueing() {
    let hang = Hang::default();
    let config = WorkspaceIoConfig {
        max_threads: 1,
        deadline: Duration::from_secs(5),
        ..config()
    };
    let io = WorkspaceIo::with_mount_list(config, mounts(), |_| Ok(()));
    let parked = tokio::spawn({
        let io = io.clone();
        let op = hang.op();
        async move { io.run(Path::new("/home/user/slow"), op).await }
    });
    tokio::time::sleep(Duration::from_millis(50)).await;
    let refused = io.run(Path::new("/home/user/other"), || Ok(())).await;
    assert!(matches!(refused, Err(WorkspaceIoError::Saturated { .. })));
    hang.release();
    assert!(parked.await.is_ok_and(|result| result.is_ok()));
}
