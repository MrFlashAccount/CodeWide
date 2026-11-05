# Workspace IO

## Purpose and owner

The one owner of access to user workspace paths from the companion process: agents' working directories, projects, Git trees and files inside them. Such paths can live on a FUSE or network mount (an Arcadia `arc` mount) whose daemon stops answering; every syscall on it then blocks uninterruptibly. This crate guarantees that a hung mount fails only the requests that touch it. Code owner: backend.

## Invariants

- Every operation on a workspace path runs on a thread of this crate's own, never on a runtime worker or the runtime's blocking pool (which the companion's stores share); its caller waits at most a deadline (default 10 s) and gets `WorkspaceIoError::TimedOut`.
- A mount that can hang (`fuse*`, NFS, SMB, 9p, Ceph, AFS) has a circuit breaker. A timeout marks it unhealthy; every later operation on it fails at once with `Unavailable`, without a thread, until a background probe (`metadata` of the mount point every 15 s) or a late successful completion shows it answers.
- At most 8 operations wait on one such mount and at most 128 operation threads live at once; more fail with `Saturated` instead of queueing. A thread parked on a hung mount cannot be cancelled, so the caps bound the threads hung mounts can hold.
- The mount of a path comes from `/proc/self/mountinfo`, matched lexically; the path itself is never touched to find it.
- A slow local disk only times out; it has no breaker.

## Rules for callers

- Touch a workspace path only through `WorkspaceIo::run` / `run_within` (`WorkspaceIo::shared()` in production). No `std::fs` on such a path in async code, and no `tokio::fs` or `spawn_blocking` around it without this crate.
- A subprocess whose working directory is a workspace (`git`, an agent CLI) is spawned inside `run`, because spawning blocks until the child has entered that directory. Waiting for the child is the caller's, with its own timeout.
- Never await an operation while holding a shared lock or inside a serial owner (an actor loop, a channel drained by one task). Read first, then take the lock briefly to apply the result. The deadline protects the caller, not the callers queued behind it.
- The companion's own state (`~/.local/state/codewide`, `~/.codex`, `~/.claude/projects`, `~/.codewide`) is on local disk and is not a workspace path.

## Verification

`cargo test -p workspace-io`, `cargo clippy -p workspace-io --all-targets -- -D warnings`.
