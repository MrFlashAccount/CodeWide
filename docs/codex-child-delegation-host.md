# Codex child delegation on this Linux host

## Deployment handoff (2026-10-23)

Sergey authorized porting, validation and deployment to `/home/sergeigarin/projects/CodeWide`.
Preparation confirmed that all 34 patch paths apply directly to main revision
`633a6a6cda957040fd915f9898ea725718b7c874`; none overlaps the current dirty files.
No main-checkout file has been changed. This session's filesystem permissions allow writes
only in the isolated checkout, `/tmp` and `/var/tmp`, so the main port and service installation
cannot run here. There is no elevation channel in this session.

Main-checkout tests: **not run**. Release script: **not started**; there is no output tail.
Companion/app-server: **not restarted**. Live task
`052708b6-adbd-46e1-b059-1bd0bf5daaf9`: no post-restart verification was possible.
The complete ready-to-apply patch is `docs/codex-child-delegation-main.patch` in the isolated
checkout. Continue in a session with main-checkout write access and user-service access;
preserve dirty work, apply the patch, run the requested orchestration/store and Clippy/format
checks, replace this handoff with their actual results, then run the approved one-shot below.
Capture its output into a durable log and stream its tail into this report before installation
can restart the session. Do not commit, push, stash, reset, or clean the tree.

## Diagnosis (2026-10-23)

The installed generation reports source revision `21f7582e7abd4ba70cd8e04c65cfafc58367e5f7`,
which is also this fix's base revision. No installed files or services were changed.

| Task | Evidence | Cause |
| --- | --- | --- |
| `c756fb2d-e614-4d85-a8d1-d9f0963c9a13` | Workspace operation `b813f836-53e2-4752-8b2d-0de0b0088bdb` failed: source not owned by a configured VCS provider. | Legacy spawn converted explicit `:workspace` to `isolatedWrite`; the source was a non-VCS directory. No child was created. |
| `d90016e4-b2d2-4f9c-8179-17e9613bcc30` | Workspace operation `bd7aedae-c35b-48f8-a0fc-acbe09c22f33` failed for the same source. | Same conversion and failure. |
| `d5b9d2eb-de8a-4321-9b93-6b287311b04f` | Recorded permission envelope: requested `:workspace`, translated `:read-only`. Child `01a169d7-b999-7592-ae0c-617b76d3a21f` records `sandbox_policy: read-only`, root read access only, restricted network, approval policy `never`. | `sharedReadOnly` deliberately overrides writable requests. `/tmp` is read-only too. Cargo exited 101 with `Read-only file system (os error 30)` before compilation. The task is marked `succeeded` because the agent completed its turn with a blocked report; that status does not prove the requested build succeeded. |
| `e57c64c6-b572-4753-b373-311be95f2dd6` | Workspace operation `5a655b05-1f85-421c-891c-0d202a5de0fc` failed: source not owned by a configured VCS provider. | `isolatedWrite` uses `workspace.create@1`; it is not a writable sandbox switch or an arbitrary-directory copy. |

Evidence locations, relative to the user's home:

- `.local/lib/codewide/current/metadata.json`: installed source revision.
- `.local/state/codewide/companion/state.redb`: task permission envelopes, parent id and workspace claim ids. Raw byte inspection found matching records; the live database was not opened for writing or treated as a transactionally consistent snapshot.
- `.codex/worktrees/<operation-id>/.codewide-workspace-operation.json`: authoritative workspace failure checkpoints for the three failed preparations.
- `.claude/projects/-home-sergeigarin-arcadia-yandex360-frontend-services-volga/01a15f0f-5f32-7f83-aff7-af279be733e0.jsonl`: authenticated calls and returned results, 17:38–17:40 UTC.
- `.codex/sessions/2026/10/23/rollout-2026-10-23T20-38-27-01a169d7-b999-7592-ae0c-617b76d3a21f.jsonl`: child's effective policy and build failure report.
- `.local/state/codewide/companion/vcs-plugins.json`: Arc and Git providers, neither owning these source directories.

`journalctl --user -u codewide-companion` contained no matching task errors. In this path,
workspace creation returned a **failed operation**, not an exception; the coordinator silently
failed the task. It discarded the operation failure without marking the workspace claim failed.
The result projector only read provider turns, so pre-child failures had no `finalMessage`.
Legacy spawn then labelled every missing child as uncertain, even for a terminal failed task.

The recorded parent's ceiling was `:full-access`; these failures were not ceiling violations.
The October 14 note is not the current source contract: `permission_profiles.rs` already maps
Claude `:full-access` to Codex `:danger-full-access` when required by the target catalog.
The old rank check also treated the two unrestricted spellings as unequal. The patch makes them
equal, so inheriting Claude full access uses Codex's supported unrestricted profile.
The user's `.codex/config.toml` currently sets `sandbox_mode = "danger-full-access"` and
`approval_policy = "never"`; explicit child permissions override that default. Changing the
global sandbox default would not fix the VCS failures or `sharedReadOnly` coercion.

## Deferred completion diagnosis

Task `2474a43f-8cd7-494f-90b1-fa9809f8b7c4` exposed a separate missing path.
The coordinator selected only `awaitingResume`; terminal processing persisted that state,
and only `wait_task` acknowledged it. There was no completion sender. Startup recovery
scanned nonterminal tasks only, so it could not recover an undelivered terminal result.
The capability `orchestration.externalDelivery` was false for both providers by design.

Evidence from the same parent transcript and the child's rollout (UTC, 2026-10-23):

- Deferred acceptance returned at 18:13:52.952.
- The child's authoritative turn `01a169f8-26cb-72c0-82b5-240adb1dbf95` completed at
  19:17:47.414 in
  `.codex/sessions/2026/10/23/rollout-2026-10-23T21-13-52-01a169f8-2681-79b3-a7b7-232ebc34a9ce.jsonl`.
- The parent's next `wait_task` call was at 19:47:02.773, about 29 minutes later.
- The matching live database record contains `waitMode: deferred`, `state: succeeded`,
  delivery route `awaitingResume`, state `acknowledged`. Its modification time includes
  acknowledgement and is not proof of when terminal state was first recorded.
- The parent's Claude journal state has `origin: created` and the same session id: it
  is a Companion-managed Claude session, which the existing turn port can resume.

## Implemented behavior

Both tools default to the authenticated parent's permissions and cwd. `permissionProfile` and
`workspace` are optional. A different explicit cwd is used directly, without Git or Arc ownership.
`sharedReadOnly` remains accepted as a legacy spelling of `inherit`, with no permission override.
Only explicit `isolatedWrite` uses VCS workspace preparation. No host flag or per-child authorization
object is involved. An explicit profile may restrict access but cannot exceed the parent. The two
full-access profile names have equal rank and are translated through the target provider catalog.
Unknown parent permissions cause an explicit inheritance error instead of a read-only fallback.

Native execution observations also preserve network access, extra writable roots, temporary-root
exclusions and approval/reviewer settings in the durable task envelope. Codex applies those at
thread creation instead of replacing the policy with a built-in profile's defaults. Named profiles
retain their configured rules, since the legacy sandbox projection cannot describe every exclusion.
Projected Claude compatibility settings are not treated as authoritative OS sandbox observations;
Claude continues using the inherited profile and its existing CLI settings sources. An adapter that
cannot reproduce an explicitly observed sandbox rejects it, rather than silently restricting it.
This does not establish equivalence of arbitrary custom sandbox rules across different providers.

Workspace preparation failures now persist a closed diagnostic on the failed workspace claim.
`wait_task` returns it even if no child or provider turn exists. Legacy spawn identifies a known
pre-child failure instead of calling it uncertain. Raw VCS error payloads remain in the workspace
operation checkpoint; old failed task records are not rewritten.

Deferred `codewide_delegate_task` results now use a durable `parentTurn` route for either
parent provider. Completion queues an ordinary injected parent message containing task/child
ids, terminal outcome, final report and cost. An idle parent starts automatically; a busy
parent receives the queued message after its current turn ends. No polling is needed.
Final text is capped at 32,000 Unicode characters with a truncation marker; full text remains
available through `wait_task` and child history. Transiently missing or still-running history
is retried before publishing a completion.

The journal's `Enqueued` ownership marker and the outbox write commit in one transaction.
The existing turn-delivery owner handles dispatch, retries, receipts and uncertain starts;
startup also scans terminal completions awaiting handoff. A stable command key and durable
ownership transfer prevent duplicate enqueue after replay or restart. A terminal `wait_task`
acknowledgement that commits first suppresses an unnecessary push. Old fallback records,
blocking delegates and legacy spawn retain their previous delivery route. This patch uses
ordinary injected turns, not a provider-native background-notification API; its capability
flag therefore stays false.

## Source location

The changes are uncommitted in the isolated checkout based on
`21f7582e7abd4ba70cd8e04c65cfafc58367e5f7`.

- `crates/companion-core/src/agent/orchestration/{tools,admission,profiles}.rs`: optional
  arguments, inherited cwd, opt-in isolation and equivalent full-access names.
- `orchestration/coordinator/admission_plan.rs`, `permission_profiles.rs`,
  `client_wire/execution.rs`, `crates/agent-core/src/provider/execution.rs`,
  `crates/agent-provider-codex/src/execution.rs`: frozen native execution settings and adapter conversion.
- `orchestration/{journal,coordinator,delivery}.rs`: durable preparation diagnostics.
- `orchestration/{notifications,delivery,journal,task}.rs`, `turn_delivery.rs`,
  `store/turn_delivery_tables.rs`: terminal-result recovery and atomic parent-message handoff.
- `orchestration/notification_tests.rs`, `orchestration/notification_journal_tests.rs`: automatic Claude parent wake-up, busy
  parent deferral, terminal outcomes, replay deduplication, transaction rollback and startup recovery.
- `orchestration/inheritance_tests.rs`: provider matrix, non-git cwd/Cargo/temp writes,
  policy persistence and diagnostics regressions.

## Deployment and restart (not performed)

Wait until the live parent and measurement run have finished, then run from this patched checkout:

```sh
./scripts/release-candidate-companion
```

The repository one-shot owns format, Clippy, tests, optimized build, generation install, service
reload/restart and installation verification. Its installer runs `systemctl --user daemon-reload`
and `systemctl --user restart codewide-companion.service`. Do not run separate manual install or
restart steps. Report the one-shot's final JSON and stop if any gate fails. The full-test
stall described below must be resolved, or shown to be confined to this outer sandbox,
before deployment can pass its test gate.

No app-server binary or configuration is changed by this patch, so no app-server restart is needed.
Start/resume a parent through the updated Companion so it receives the new tool declarations.
No permission-profile or sandbox-mode config change is required for the reported Claude full-access
parent: its Codex child inherits equivalent full access. Altering the parent profile or global sandbox
configuration is a separate user-approved change; this patch does neither.

## Verification

Required source checks:

```sh
pnpm test:companion
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

The regression suite covers both provider directions, omitted options, non-git cwd, explicit profile
restrictions, full-access aliases, explicit isolation failure diagnostics, durable native policy and
child-to-grandchild policy inheritance. Scripted provider tests establish orchestration behavior;
they do not establish successful execution by the live model or host systemd.

Validation in this workspace:

- All 65 orchestration tests passed, including a real dependency-free Cargo program that writes
  cwd and `/tmp` after scripted Codex child admission. This is not a live Codex model execution.
- The automatic Claude-parent notification regression failed before the fix (no parent turn
  started), then passed without any `wait_task` call. Additional tests cover a busy parent,
  failed/cancelled children, delayed final history, replay, atomic rollback, acknowledgement
  races and restart recovery. A persistence compatibility test keeps the original fallback
  encoding readable and rejects an invalid fallback/outbox state. These use scripted
  providers, not a live Claude model.
- All 11 store tests passed, including the five durable turn-delivery claim/recovery tests.
- Native execution conversion tests passed in the client-wire owner and Codex adapter.
- Workspace-wide Clippy with `-D warnings`, Cargo format and `git diff --check` passed.
- The broader companion `agent::` run passed 130 tests and failed six existing Unix-socket
  tests with EPERM at `UnixListener::bind`; the sandbox denies sockets.
- `CARGO_NET_OFFLINE=true pnpm test:companion` ran without exclusions and was bounded to
  180 seconds. It timed out in the unchanged Claude test
  `runtime::probe::tests::a_silent_claude_times_out_and_is_closed`. The same test had stalled
  for over ten minutes in the earlier run. Its root cause was not established here.
- Logs: `/tmp/codewide-inherit-focused.log`, `/tmp/codewide-inherit-wire-test.log`,
  `/tmp/codewide-inherit-codex-test.log`, `/tmp/codewide-inherit-clippy.log`,
  `/tmp/codewide-inherit-agent-tests.log`, `/tmp/codewide-inherit-workspace-tests.log`.
  Notification checks: `/tmp/codewide-notify-before.log`, `/tmp/codewide-notify-focused.log`,
  `/tmp/codewide-notify-clippy.log`, `/tmp/codewide-notify-workspace-tests.log`,
  `/tmp/codewide-notify-store-tests.log`, `/tmp/codewide-notify-outbox-tests.log`.

The installed Companion unit's `zz-claude-cli-parity.conf` clears its filesystem, namespace and
address-family restrictions. The Codex app-server is a separate daemon. These configuration
files were read only; effective user-manager state could not be queried through this sandbox.
No service hardening or parent permission setting was changed.

A separate temporary Codex app-server with its own CODEX_HOME successfully initialized and created
a `gpt-6.1-sol` thread in a non-git cwd, reporting the requested workspace sandbox, network access
and writable temporary roots. Its standalone `command/exec` build probe timed out in this outer
sandbox. This is not a passing Cargo-in-Codex or systemd test. No running service was restarted or
reconfigured. The outer sandbox denies app-server/systemd socket connections with EPERM.

After deployment, call `codewide_spawn_agent` from the intended parent, omitting both profile and
workspace (use that parent's non-git cwd):

```json
{
  "provider": "codex",
  "model": "gpt-6.1-sol",
  "prompt": "In a fresh disposable subdirectory of cwd, create and run a dependency-free Rust crate with cargo run --offline and a Node script. Verify file writes in that cwd and in a temporary directory under /tmp. Probe systemd-run --user --wait --collect /usr/bin/true. Report commands, exit codes and the actual filesystem/network policy; preserve existing files."
}
```

Wait on the returned child id and inspect command exit codes and the child rollout's effective
policy. Repeat with `codewide_delegate_task`, `waitMode: deferred`, omitting workspace and profile.
Successful turn completion alone does not prove the build succeeded. A child can only reach the
user systemd bus or network if the parent can; permission inheritance creates no additional rights.

For deferred-completion verification after deployment, make a fresh `codewide_delegate_task`
call from a Claude parent with `provider: codex`, `model: gpt-6.1-sol`, `waitMode: deferred`
and a short task that returns a unique marker. Let the parent finish its turn and do not call
`wait_task`. Completion must automatically start a parent turn containing that task id,
terminal status and marker. Repeat while the parent is busy: its current turn must continue,
then the queued result must start after it becomes idle. Old acknowledged task records are
not replayed. No permission or sandbox configuration change is needed for this delivery path.
