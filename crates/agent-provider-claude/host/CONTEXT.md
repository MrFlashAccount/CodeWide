# Claude agent host

## Purpose and owner

A Node process that serves the neutral `codewide-agent` v1 protocol over stdio on top of the Claude Agent SDK and the user's own `claude` CLI. It exists only as a child of the companion: the Rust Claude adapter ([`crates/agent-provider-claude/src/`](../src/), see [`../CONTEXT.md`](../CONTEXT.md)) launches and supervises it, and clients never reach it directly. Together the two form the Claude provider. Package: `@codewide/claude-agent-host` (formerly `apps/claude-sidecar`, `@codewide/claude-sidecar`). Code owner: backend. This document: architect. Cross-zone contract: [`docs/agent-providers.md`](../../../docs/agent-providers.md).

## Module jobs

- `src/main.ts` — process entry: wires configuration, the host's thread metadata store, Claude's session store, the SDK runtime, the thread service and the stdio server.
- `src/config.ts` — validation of the launch arguments (`--claude-executable`, `--journal-directory` or its replacement `--state-directory`, `--idle-release-minutes`); an invalid launch exits before the handshake.
- `src/log.ts` — structured JSON-lines logging to stderr.
- `src/version.ts` — the host version reported in the provider descriptor (equals `package.json` `version`).
- `src/protocol.ts` — the host's view of `codewide-agent` v1: types re-exported type-only (`export type *`), the few restated runtime constants (including the Claude capability set) and the id brand constructors (the only type assertions, each with a narrow, justified exception).
- `src/rpc/` — `server.ts`: JSON-RPC over JSONL stdio, `initialize` version negotiation and the capability declaration (Claude column of the capability table); `validate.ts`: structural param validation at the boundary before any id is branded.
- `src/validation/` — shape-check combinators (`checks.ts`) and checks of neutral model values (`modelChecks.ts`), shared by RPC validation and the state codec. Pure.
- `src/threads/` — `service.ts`: the protocol operations over Claude's session store, the host's metadata and the live sessions; `nativeSessions.ts`: `nativeSession.list` / `nativeSession.read` for the companion's native Claude index (the host's role as the Claude session parser); `registry.ts`: thread entries (metadata + live session), session-chain index and restart finalization; `session.ts`: one thread's live session lifecycle (`Shell` → `Active` ↔ `Idle` → `Released` → resumed; lost-session recovery; idle release, never while a turn is active or a request is pending, background tasks defer up to 4 h; busy `turn.start` while active; explicit steer; bounded interrupt); `turnBuilder.ts`: one neutral turn from classified frames, owning the per-turn ordering rules and user-message item ids (`{turnId}:user:{n}`), used by both the live path and history; `history.ts`: history of a thread's session chain with the live snapshot of the active turn; `projection.ts`: `AgentThread` from Claude's session metadata plus host metadata; `sessionCatalog.ts`: Claude's session listing (rescanned on every call) and the last metadata seen per session for live projections; `listing.ts`: pure `thread.list` filtering, ordering and cursors; `prompt.ts`: neutral user content → SDK prompt blocks.
- `src/history/` — pure reconstruction of neutral turns from Claude's stored messages: `entries.ts` (message classification), `segments.ts` (derived turn boundaries), `reconstruct.ts` (segments replayed through `TurnBuilder`, turn index applied), `prefix.ts` (bounded history prefix for a replacement session).
- `src/mapping/` — pure SDK frame classification (`frames.ts`), tool call → neutral item mapping with item ids `{message.id}:{blockIndex}` and `tool_use.id` (`tools.ts`), edit-tool diffs (`diffs.ts`), JSON conversion (`json.ts`) and `result` frame → turn outcome (`result.ts`). No I/O.
- `src/permissions/` — `profiles.ts`: permission profiles (`:read-only`, `:workspace`, `:full-access`/`:danger-full-access`) as SDK query options and the profile catalog; `approvals.ts`: the `canUseTool` decision mapping.
- `src/state/` — the host's own thread metadata: `threadState.ts` (types), `codec.ts` (shape checks), `stateStore.ts` (atomic files) and `legacyJournal.ts` (one-way reader of the former sidecar's v1 journal). The only persistent state the host writes.
- `src/claude/` — `port.ts`: SDK-free types the rest depends on; `sdkRuntime.ts` (live queries) and `sdkSessionStore.ts` (Claude's session store: paged list, info, messages, sub-agents, rename, delete) are the only modules that import `@anthropic-ai/claude-agent-sdk`.
- `src/catalog/` — the model catalog (`models.ts`).
- `src/support/` — `unreachable.ts`, the exhaustive-switch guard.
- `install/` and `scripts/checkInstallLock.mjs` — the install lock of the runtime dependencies; `package.json` is the single SDK version source and the check fails the tests on drift.
- `test/fixtures/*.ndjson` and `test/golden/` — recorded SDK streams and their committed neutral replays; the companion's `client_wire` golden tests project the `*.neutral.jsonl` files. `test/fixtures/sessions/` — sanitized `getSessionMessages` output of local probe sessions for the history contract tests. `experiments/` holds the paid SDK experiment scripts (not run).

## History and metadata

- The Claude provider is symmetric with Codex: the Rust adapter crate owns the native index of Claude's sessions in the companion's `state.redb` and a watcher on Claude's session files; this host is the parser. `nativeSession.list` pages every Claude session (programmatic and interactive) with change metadata; `nativeSession.read` returns one session and its sub-agents as neutral turns with ids derived only from stored messages and the turn index, so re-indexing is idempotent. The host keeps no conversation copy and no index or cache of history.
- Thread list, read and history come from Claude's own session store through the SDK session API (`listSessions`, `getSessionInfo`, `getSessionMessages`); rename and delete use `renameSession` and `deleteSession`. Sessions a person started outside CodeWide (for example, `claude` in a terminal, `listSessions({includeProgrammatic: false})`) are listed next to CodeWide's threads; their session id is the thread id. Other SDK-started sessions are not listed unless the host owns them.
- The host keeps only what Claude's store cannot tell (`ThreadState` v2 in `<state dir>/threads/<id>/state.json`): the session chain, settings and pending settings, the archive flag and the delete tombstone, a title override (a name given before the session exists, or a cleared name), a turn index (turn id, origin, outcome, prompt uuids with their `clientMessageId` and role) and cumulative usage. `active-turn.json` holds the in-flight turn's snapshot until it ends. Neither file holds conversation content.
- `nativeSession.list` carries the thread's CodeWide metadata (including the thread's `cwd`) in `NativeSession.codewide` (`codewideMetadata` in `projection.ts`; omitted for sessions CodeWide never touched) and keeps tombstoned sessions, flagged `presence.type: "deleted"`. `fileSize` and `lastModifiedMs` are the session file's byte size and mtime in ms, as the SDK reports them. Each session's turns are only that session's share of the thread.
- Every turn and item the host emits carries `provenance {provider: "claude", nativeThreadId: <appThreadId>}`, stamped by `TurnBuilder` (live and history alike).
- The host declares `threads.externalDiscovery`: `thread.owns` answers for any session in Claude's store that is not another thread's continuation.
- A user turn's id is the uuid of its first prompt offer, which Claude persists, so live and history agree on turn ids; history items are built by the same `TurnBuilder` as live items.

## Dependency rules

- Only `src/claude/sdkRuntime.ts` and `src/claude/sdkSessionStore.ts` import the SDK. `src/mapping/`, `src/history/`, `src/validation/` and `src/threads/listing.ts` are pure.
- `@codewide/agent-protocol` is imported type-only; `dist/` contains no `@codewide/` import.
- Never touches `state.redb` or `CODEX_HOME`; reads no `ANTHROPIC_*` value and no Claude credentials. Claude's configuration directory is reached only through the SDK session API (conversations, titles, listings) and the SDK query runtime; no source builds a path into it. Auth state comes only from the SDK initialization result.

## Invariants

- Neutral ordering rules hold for every live and every rebuilt turn (see `packages/agent-protocol`).
- `turn.start` on an active thread returns `busy {activeTurnId}`; it never steers.
- `canUseTool` never returns `null`; a decline or response error never becomes allow; `acceptForSession` never writes a settings file. `:read-only` cannot write through built-in tools or MCP.
- Rename, archive and settings repeats answer with the current thread and emit `thread.updated` only on a real change; delete is idempotent through the tombstone (a session Claude no longer has counts as deleted) and never hangs.
- `rate_limit_event` is logged only, never surfaced as an error.
- Logs carry full errors in `err` and opaque ids only; never prompts, outputs, tool inputs or env values.
- No live-session cap; the live session count is logged at `info` on every open and release.

## Validation

`pnpm --filter @codewide/claude-agent-host test` (install lock, fixture replay, live ↔ history parity, history contracts, SDK session-store adapter on a throwaway config directory), `pnpm --filter @codewide/claude-agent-host lint` (type-aware oxlint with the shared hygiene preset), `pnpm --filter @codewide/claude-agent-host format:check` and `pnpm typecheck`.
