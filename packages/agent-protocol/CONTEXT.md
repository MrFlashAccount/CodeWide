# Agent protocol (`codewide-agent` v1)

## Purpose and owner

This package is the source of truth for the neutral companion ↔ provider protocol: TypeScript types for the neutral model (threads, turns, items, runtime requests), events, operations, branded ids and the capability vocabulary, plus versioned round-trip fixtures. The cross-zone contract is described in [`docs/agent-providers.md`](../../docs/agent-providers.md).

Code owner: backend. This document: architect.

## What belongs here

- `src/v1/**` — the v1 neutral model, operations, events and capability names. Discriminated unions with literal discriminators; `readonly` fields; branded ids for `ProviderId`, `AppThreadId`, `ProviderThreadRef`, `TurnId`, `ItemId`, `RuntimeRequestId`, `ClientMessageId`.
- `CodewideAgentThreadExtension` (`src/v1/capabilities.ts`) — the shape of the client-wire field `Thread.codewideAgent {provider, providerName, primary, capabilities}`. The companion attaches it, and the `codewideAgentProvider` / `codewideAgentProviders` catalog annotations, only when more than one provider is enabled; a thread without it is a legacy Codex thread with every capability. The Rust producer is `crates/companion-core/src/agent/client_wire/mod.rs`.
- `Provenance {provider, nativeThreadId}` (`src/v1/model.ts`) — the optional origin of every `AgentTurn` and `AgentItem` (`WithProvenance`): the provider native thread a turn or item came from, for app threads that span several binding segments. Absent means the thread's only native thread; adapters stamp it where absent.
- `NativeSession.codewide` (`NativeSessionCodewide`, optional) — the CodeWide thread metadata a native index needs for the thread's list row: `createdAt`, `cwd` (the thread's working directory), `origin`, `presence` (listed + archived, or deleted tombstone), `recencyAt`, effective `settings`, `title` override, `updatedAt`.
- Optional native-session operations (`nativeSession.list`, `nativeSession.read`; `NativeSession`, `NativeSubagent` in `src/v1/model.ts`) — added within v1 for a provider adapter's native index (Claude: the companion indexes Claude's own sessions through the Claude agent host). They are called only by the provider's own adapter crate; a provider without a native store answers `-32601`. Turn and item ids in `nativeSession.read` are deterministic for unchanged stored input. Fixture: `fixtures/v1/native-sessions.json`; the Rust mirror (`crates/agent-core/src/model/operations.rs`) must add the same operations and types in the same change, or its fixture round-trip fails.
- `fixtures/v1/*.json` — shared fixtures that both this package and the Rust mirror (`crates/agent-core/src/model/`, round-trip test `fixture_tests.rs`) must round-trip unchanged. The fixtures are the protocol's compatibility contract and are owned here, not by consumers.

Does not belong: provider-specific behavior, Codex client-wire shapes, SDK types, transport framing, runtime code with side effects.

## Version policy

- Changes within v1 are additive only (new optional fields, new union members that consumers may ignore, new capability names).
- A breaking change creates `src/v2/**` and `fixtures/v2/**`; `initialize` negotiates the version. A mismatch disables that provider with the `error` log "agent protocol version mismatch".
- A fixture changes only together with a deliberate protocol change in this package and the Rust mirror in the same change.

## Dependency rules

- This package depends on no other `@codewide/*` package and no provider SDK.
- Consumers import it type-only where they have no runtime need (the Claude agent host `crates/agent-provider-claude/host` uses `import type`, so its `dist/` contains no `@codewide/` import).
- The client (`apps/android`, `packages/sync-client`, `packages/renderers`) does not import this package in phase 1; it speaks the Codex-shaped client wire and validates `codewideAgent` with its own reader (`apps/android/src/data/threadAgent.ts`), which must stay compatible with `CodewideAgentThreadExtension`.

## Code hygiene

The package uses the shared hygiene preset `@sergeigarin/hygene` (`libraryConfig`: type-aware oxlint with compiler diagnostics, explicit API types) and `tsconfig.library.json` (`isolatedDeclarations`) for `src/`; tests use `tsconfig.node.json` (`test/tsconfig.json`). There is no baseline file; a narrow exception names one rule on one line with an adjacent `WHY` comment.

## Validation

`pnpm --filter @codewide/agent-protocol test`, `pnpm --filter @codewide/agent-protocol lint`, `pnpm --filter @codewide/agent-protocol format:check`, `pnpm --filter @codewide/agent-protocol typecheck` and the Rust fixture round-trip in `pnpm test:companion`.
