# Claude sidecar

## Purpose and owner

A Node process that serves the neutral `codewide-agent` v1 protocol over stdio on top of the Claude Agent SDK and the user's own `claude` CLI. It is launched and supervised only by the companion's Claude adapter (`crates/companion-core/src/agent/providers/claude/`). Clients never reach it directly. Code owner: backend. This document: architect. Cross-zone contract: [`docs/agent-providers.md`](../../docs/agent-providers.md).

## Module jobs

- `src/main.ts` — process entry: wires configuration, journal, SDK runtime, thread service and the stdio server.
- `src/config.ts` — validation of the launch arguments (`--claude-executable`, `--journal-directory`, `--idle-release-minutes`); an invalid launch exits before the handshake.
- `src/log.ts` — structured JSON-lines logging to stderr.
- `src/version.ts` — the sidecar version reported in the provider descriptor (equals `package.json` `version`).
- `src/protocol.ts` — the sidecar's view of `codewide-agent` v1: types re-exported type-only (`export type *`), the few restated runtime constants (including the Claude capability set) and id branding helpers.
- `src/rpc/` — `server.ts`: JSON-RPC over JSONL stdio, `initialize` version negotiation and the capability declaration (Claude column of the capability table); `validate.ts`: structural param validation at the boundary before any id is branded.
- `src/threads/` — `service.ts`: the thread registry and protocol operations over the journal and live sessions; `session.ts`: one thread's live session lifecycle (`Shell` → `Active` ↔ `Idle` → `Released` → resumed; lost-session recovery; idle release, never while a turn is active or a request is pending, background tasks defer up to 4 h; busy `turn.start` while active; explicit steer; bounded interrupt); `turnBuilder.ts`: one neutral turn from classified frames, owning the per-turn ordering rules and user-message item ids (`{turnId}:user:{n}`); `listing.ts`: pure `thread.list` filtering, ordering and cursors; `prompt.ts`: neutral user content → SDK prompt blocks.
- `src/mapping/` — pure SDK frame classification (`frames.ts`), tool call → neutral item mapping with item ids `{message.id}:{blockIndex}` and `tool_use.id` (`tools.ts`), and `result` frame → turn outcome (`result.ts`). No I/O.
- `src/permissions/` — `profiles.ts`: permission profiles (`:read-only`, `:workspace`, `:full-access`/`:danger-full-access`) as SDK query options and the profile catalog; `approvals.ts`: the `canUseTool` decision mapping.
- `src/journal/` — the sidecar's own journal (thread metadata, turn records, list/turn cursors). The only persistent state the sidecar writes.
- `src/claude/` — `port.ts`: SDK-free types the sessions depend on; `sdkRuntime.ts`: the only module that imports `@anthropic-ai/claude-agent-sdk`.
- `src/catalog/` — the model catalog (`models.ts`).
- `host/` and `scripts/check-host-lock.mjs` — the host install lock; `package.json` is the single SDK version source and the check fails tests on drift.
- `test/fixtures/` and `test/golden/` — recorded SDK streams and their committed neutral replays; the companion's `client_wire` golden tests project the `*.neutral.jsonl` files. `experiments/` holds the host SDK experiment scripts.

## Dependency rules

- Only `src/claude/sdkRuntime.ts` imports the SDK. `src/mapping/` and `src/threads/listing.ts` are pure.
- `@codewide/agent-protocol` is imported type-only; `dist/` contains no `@codewide/` import.
- Never touches `state.redb`, `CODEX_HOME`, Claude credentials or `~/.claude` files; reads no `ANTHROPIC_*` value. Auth state comes only from the SDK initialization result.

## Invariants

- Neutral ordering rules hold for every turn (see `packages/agent-protocol`).
- `turn.start` on an active thread returns `busy {activeTurnId}`; it never steers.
- `canUseTool` never returns `null`; a decline or response error never becomes allow; `acceptForSession` never writes a settings file. `:read-only` cannot write through built-in tools or MCP.
- `rate_limit_event` is logged only, never surfaced as an error.
- Logs carry full errors in `err` and opaque ids only; never prompts, outputs, tool inputs or env values.
- No live-session cap; the live session count is logged at `info` on every open and release.

## Validation

`pnpm --filter @codewide/claude-sidecar test` (fixture replay, fake query, host lock check) and `pnpm typecheck`.
