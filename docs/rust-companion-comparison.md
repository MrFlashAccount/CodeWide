# Rust companion: Node comparison and rollout verdict

Date: 2026-08-17

## Outcome

The Rust companion is the production implementation and runs with mutations
enabled on loopback. The Node companion was retained during rollout as an
instant route-level rollback target.

Verdict:

- **Contract and stable-history parity: PASS.**
- **Public WSS mutation smoke: PASS.** Start, rename, goal, turn, read, fork,
  archive/unarchive and delete all completed through the public route.
- **Production route cutover: PASS.** FRP now targets `8766`; public health reports
  `implementation=rust`.
- **Physical Android session: PENDING OBSERVATION.** Existing device token hashes are
  shared with Node, but only the phone can prove resume/background behavior end to end.

## Implemented boundary

- The external V1 HTTP, WebSocket, RPC, authentication and scope contract is frozen
  from the Node implementation and covered by wire-level tests.
- Canonical append-only Codex rollout JSONL is the only full-history source.
- `thread/resume` materializes the authoritative initial turn window in the
  companion. Android no longer merges that window with a stale cached shell.
- Live replay frames carry a frozen, constant-size `codewideThreadPatch.v1`
  operation. Rust owns App Server method interpretation and thread-list
  activity semantics; Android only mirrors the patch into its offline database
  and keeps a raw-event adapter for rollback to an older companion.
- `redb` stores compact indexes, bounded replay state, the exactly-once turn outbox,
  device/session state and derived resource projections. It does not duplicate full
  thread bodies.
- History is tail-first and cursor-paginated. Malformed/incomplete writer fragments
  are skipped without corrupting the canonical source.
- Active transport supports replay, backpressure, reconnect, approvals, queued
  mutations and ambiguous-delivery reconciliation.
- Pairing/auth, files and resumable uploads, private content, media proxying,
  localhost ports/tunnels, raw App Server bridging, resource/change projection and
  OAuth dictation are implemented.
- Exact preview-path translation across `PrivateTmp` bind mounts and the public
  loopback-only OTA/build-shelf proxy are implemented.
- `account/rateLimits/read` is forwarded as a `threads.read` RPC and covered on
  the wire.
- Interrupted turns without a terminal record retain their canonical attachments and
  file changes. Explicit `thread_rolled_back` records remove rolled-back resources.
- A corrupt derived resource index is quarantined and rebuilt. A corrupt operational
  index fails closed because silently rebuilding it could lose outbox/replay delivery
  guarantees.

## Correctness evidence

Final local gates:

- `cargo fmt --check`: pass.
- `cargo clippy --workspace --all-targets -- -D warnings`: pass.
- `cargo test --workspace`: **46 tests, 0 failures**.
- Host-companion TypeScript typecheck: pass.
- Shadow authentication and health verification: pass.
- systemd security exposure: **3.6 / OK** after dropping capabilities and restricting
  namespaces, devices, clocks, kernel logs, ABI and address families.

Differential tests against the running Node companion:

| Real thread | Size | Result |
| --- | ---: | --- |
| Completed small thread | 110 KB | exact thread page and resource parity |
| Completed large thread | 100 MB | exact two-page history and 182-resource parity |
| Active long-lived thread | 1.4 GB | stable pages match; sequential reads of the moving newest turn can differ while Node catches up |

The comparison harness treats non-terminal live snapshots as volatile but continues
to compare every terminal turn strictly. It also verifies that the Rust shadow rejects
mutations, preventing accidental dual writes.

Fault and rollback evidence:

- Five forced `SIGKILL` cycles recovered health and authenticated state in 17 seconds.
- The production Node process remained unchanged through the crash soak and all
  shadow installs/restarts.
- Explicit rollback rehearsal (`8766` stopped, Node verified, `8766` restarted) passed.
- Tests cover partial JSONL records, rollout replacement/truncation, corrupt indexes,
  upstream disconnect/reconnect, slow replay clients, bounded queues, retryable
  dictation and ambiguous mutation delivery.

## Reproducible performance comparison

Method: fresh isolated Node and Rust application processes, normal OS page cache,
12 warm iterations, then 8 concurrent clients with 4 requests each. No mutating RPC
was sent.

### History page latency

| Dataset | Node cold | Rust cold | Node warm p50 / p95 | Rust warm p50 / p95 |
| --- | ---: | ---: | ---: | ---: |
| 110 KB | 51.74 ms | **1.09 ms** | 0.84 / 4.21 ms | **0.48 / 0.60 ms** |
| 100 MB | 2963.17 ms | **31.81 ms** | **3.99** / 56.18 ms | 10.87 / **13.69 ms** |
| 1.4 GB | 21672.88 ms | **62.73 ms** | **2.15** / 264.25 ms | 16.53 / **18.91 ms** |

Rust removes the cold full-thread materialization cost: about 93x faster on 100 MB
and 345x faster on 1.4 GB. Node retains a better hot p50 on large histories, while
Rust has a much tighter p95.

### Session resource projection

| Dataset | Node cold | Rust cold | Node warm p50 | Rust warm p50 |
| --- | ---: | ---: | ---: | ---: |
| 110 KB | 3.46 ms | 3.25 ms | 0.56 ms | **0.43 ms** |
| 100 MB | **43.80 ms** | 172.12 ms | **9.24 ms** | 12.37 ms |
| 1.4 GB | **114.90 ms** | 1324-1567 ms | **20.02 ms** | 37-40 ms |

The remaining cold scan was changed structurally: one Aho-Corasick pass replaces
nine searches per line, input is scanned in 8 MB buffers, checkpoints are time based,
concurrent refreshes are coalesced per thread, and history reads schedule resource
prewarming. Cold projection became about 20-25% faster and post-workload Rust RSS
fell from roughly 181 MB to 124-130 MB. More importantly, opening a thread starts the
scan before the user opens Changes.

### Throughput and memory

- Concurrent warm load: Node 452.83 req/s, Rust **591.38 req/s**, zero errors for both.
- 100 MB post-workload RSS: Node 148,036 KB, Rust **66,192 KB**.
- 1.4 GB post-workload RSS: Node **280,596 KB**, Rust 290,296 KB; after concurrent
  load Rust reached 317,148 KB. The very-large resource projection therefore needs a
  canary memory budget even though normal and 100 MB threads are substantially leaner.

## Remaining observation gate

Reopen the Android app and exercise resume-after-sleep, streaming, dictation, files,
tunnel/HMR and notifications. Any failure can be rolled back by routing FRP to `8765`;
no history migration is required.

Commands and exact rollout/rollback steps are in `docs/rust-companion-rollout.md`.
The post-rewrite drift audit is in `docs/rust-companion-migration-delta.md`.
