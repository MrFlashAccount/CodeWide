# Claude provider adapter

## Purpose and owner

The Rust `AgentProvider` implementation for Claude and its host storage. It owns the Claude configuration (`providers.claude` in `agent-providers.json`), launches and supervises the Claude agent host child ([`host/`](host/CONTEXT.md)), and speaks `codewide-agent` v1 JSON-RPC over stdio, reusing the `agent-transport` JSONL framing through its supervised constructor (`spawn_supervised_stdio`). Agent calls are forwarded to the host; protocol semantics live in the host and [`packages/agent-protocol`](../../packages/agent-protocol/CONTEXT.md). With host storage attached, the adapter also keeps an index of Claude's own session store, read through the host (Agent SDK), and serves the thread list, indexed history, discovery, message search and thread resources from it. It depends on `agent-core`, `agent-transport`, `agent-search`, `agent-resources` and `companion-host`. Code owner: backend. This document: architect. Layer contract: [`crates/companion-core/src/agent/CONTEXT.md`](../companion-core/src/agent/CONTEXT.md).

## Module jobs

- `src/lib.rs` — `ClaudeProvider`: host launch and supervision, forwarding of agent calls, `nativeSession.list` / `nativeSession.read` for the indexer (`HostSessions`), provenance stamping of every turn and item it returns or emits, and the storage-backed answers: `thread.list` and `thread.turns` from the index while fresh, `thread.owns` from the index first, `message_search`, `thread_resources`, and `history.messageSearch` / `history.threadResources` added to the host's declared capabilities.
- Health: `src/lib.rs` reports `ProviderHealth` — unavailable after a protocol version mismatch, otherwise available with the sign-in state of the `initialize` result, updated by the host's `account.updated` notifications. Only the authenticated flag, the plan label and the account label (email or organization) pass; none is a credential, and no label is logged. Subscription limits: the host's `rateLimits.updated` snapshot replaces the latest one (`AgentProvider::subscribe_rate_limits`; `None` inside until the first report); a malformed notification is logged without its payload and ignored.
- Client tools: `src/lib.rs` sends the installed tools as `clientTools` on every `thread.create` and `turn.start` while the host declares `orchestration.tools`, and answers the host's `tool.call` requests through the installed `ClientToolHost` on the same stdio channel.
- `src/config.rs` — validation of the `providers.claude` entry and the host child's environment (`PATH` with the runtime and `claude` directories first, optional `CLAUDE_CONFIG_DIR`) and the session store it implies for the watcher.
- `src/preflight.rs` — offline check that the host child could start under that environment (executables, `#!` interpreters on the host `PATH`); used by `codewide-companion providers status`. `companion-core`'s `agent/providers/mod.rs` hands the entry to it and spawns the adapter (`spawn_with_storage` with the companion's `ProviderHost`); `registry.rs` treats the entry as opaque.
- `src/store.rs` — `ClaudeStore`: the session index in the companion's index database (`state.redb`, tables `claude_sessions`, `claude_session_turns`, `claude_thread_sessions`), migrated through `companion-host`'s `DerivedIndexSchema` (`CLAUDE_INDEX_SCHEMA`, logic version `claude_index_logic_version`; a change drops and rebuilds the tables, other tables are untouched). A replacement identical to the indexed read writes nothing. A thread's history is its sessions' turns, oldest session first, one turn per id (a turn interrupted by a lost session reappears in its replacement session; the later share wins). Deleted threads are neither served nor searchable. It publishes each thread's working directory and times to the companion thread index (`HostThreadIndex`).
- `src/watcher.rs` — change detection on Claude's session store (`$CLAUDE_CONFIG_DIR/projects` or `~/.claude/projects`, `<project>/<session id>.jsonl`): size and modification time only, a debounced rescan on filesystem events and a periodic rescan. It never opens a session record or interprets Claude's format.
- `src/indexer.rs` — `ClaudeIndexer`: the startup backfill and every later listing pass over `nativeSession.list` (sessions whose size and modification time match the index are not read again, only their listed facts and CodeWide metadata are updated; sessions no longer listed are removed), watcher changes and finished live turns each read the session through `nativeSession.read`; a session the host no longer has (`-32600 "native session not found: <id>"`) is removed; reads the host cannot serve are retried once it is live. A session whose read fails while the host is live is logged with its session id (`warn`/`error`, never content), skipped and retried, so it cannot keep the other sessions out of the index; until the retry succeeds the catalog is not marked current and the host answers `thread.list`. Each pass logs `Claude session index pass finished` at `info` with the listed, read and failed counts.
- `src/catalog.rs` — the Claude thread catalog from the index: `thread.list` rows from indexed sessions and their CodeWide metadata (`NativeSession.codewide`), with the host's listing semantics (archive scope and shells, `cwd`, search over name else first prompt, sort keys with `recencyAt` falling back to `updatedAt`, windows, the `v1:<sortKey>:<direction>:<valueSec>:<id>` cursor, at most 500 rows). Deleted threads and programmatic sessions CodeWide never touched are not listed; the name is the latest store title of the chain under the CodeWide title override.
- `src/resources.rs` — thread resources of Claude threads: the shared `agent-resources` reads over projections built from the indexed neutral turns.
- `src/search.rs` — `ClaudeSearch`: the `agent-search` full-text index of indexed threads (`<state dir>/claude-message-search.sqlite`): user and agent messages as documents, `companion/search` and `companion/search/context` in the shared semantics, and windows as neutral summary turns (projected by the companion).
- `src/storage.rs` — `ClaudeStorage`: the index, the search and resource reads, the watcher and the indexer, and the freshness rules. Indexed history answers `thread.turns` only while no turn of the thread runs and no re-read of one of its sessions is pending. The catalog answers `thread.list` only after a listing pass matched the host, while no turn runs and no re-read is pending; a `thread.updated` the index would list differently (rename, archive, settings, times) schedules a new listing pass and the host answers until it ends. Otherwise the host answers.

## Capabilities

- Claude declares `threads.hostMintedIds` and `threads.externalDiscovery`: CodeWide threads are bound at `thread/start` (companion-minted UUIDv7); sessions started in a terminal or IDE are listed and discovered like Codex CLI threads (`thread.owns` answers from the index, then the host; the binding backfill pages `thread.list`, from the index once fresh).
- `history.messageSearch` and `history.threadResources` are declared by this adapter, not the host, exactly when storage is attached; `threads.crossProviderFork` is always declared by the adapter (a companion feature over ordinary operations).

## Binding segments and provenance

- Phase 1: a Claude thread is one binding segment whose native thread id is the app thread id. Every turn and item this adapter returns or emits carries `provenance {provider: "claude", nativeThreadId}`.
- The index is keyed by the host's `appThreadId` and does not know bindings. A native session that continues another app thread (a non-first segment) is hidden by the companion (thread list rows, global search hits, binding observation), not by this adapter.

## Boundary

- Must not depend on `companion-core` or `agent-provider-codex`.
- Never emits client-wire JSON and never shapes ids for the client; `agent/client_wire` does that (`wire-request-ids-v0`).
- Never opens or parses Claude's session records; only the host reads them, through the Agent SDK. The watcher reads directory entries and file metadata only.
- Does not read, store, forward or log Claude credentials, tokens or `ANTHROPIC_*` values.

## Install and configuration contract

- Config entries are absolute paths: `runtimeExecutable`, `sidecarEntry`, `claudeExecutable`; plus `journalDirectory` and `idleReleaseMinutes` (5–240, default 30). The key names stay as they are; the host accepts `--journal-directory` or `--state-directory`.
- Optional `environment` with only `PATH` (absolute directories) and `CLAUDE_CONFIG_DIR` (absolute); any other key invalidates the entry, so no credential can be configured. The host child gets `PATH` = dirname(`runtimeExecutable`), dirname(`claudeExecutable`), then `environment.PATH` or the companion's own `PATH`; `CLAUDE_CONFIG_DIR` when configured. The watcher uses the same `CLAUDE_CONFIG_DIR`.
- An invalid entry disables Claude with one `error` log carrying the full `err`; Codex is unaffected. Storage that cannot be opened is logged at `error`; the provider then answers from the host alone.
- Removing `providers.claude` disables Claude: calls on Claude threads return `-32070`; bindings, the journal and the index stay.
- `scripts/install-claude-provider.sh` (Linux and macOS; shipped in release artifacts as `codewide-install-claude-provider` with the host payload) installs the host, captures and validates the service environment, writes this config and, on Linux, installs the `claude-provider.conf` drop-in for the companion unit only (evidence in [`docs/agent-providers.md`](../../docs/agent-providers.md#systemd-hardening-linux-e-harden)).

## Supervision and failure

- Host not live → transport `UpstreamError::Reconnecting` (the outbox retries); a direct RPC gets `-32003`. The indexer waits and retries.
- A host restart resolves only Claude's pending user-interaction requests; the restarted host finalizes the open turn as interrupted.
- No live-session cap. A killed `claude` process fails only its own turn.
- More than 5 host restarts in 10 min is a rollback trigger.
