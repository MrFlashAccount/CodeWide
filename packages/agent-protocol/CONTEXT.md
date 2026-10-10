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
- Client tools (`ClientToolSpec` in `src/v1/model.ts`, `ClientToolsParam`, `ProviderRequestMap` in `src/v1/operations.ts`) — added within v1. `thread.create` and `turn.start` carry an optional `clientTools: ClientToolSpec[]` (`{name, description, inputSchema}`; absent keeps the thread's set, present replaces it; live provider state, not persisted, so the companion sends it with every `turn.start`). When the model calls one, the provider sends the provider → companion request `tool.call {appThreadId, turnId, callId, tool, arguments}` and the companion answers `{success, content: [{type: "text", text}]}` on the same stdio channel (a JSON-RPC error answer counts as `success: false`; a late answer after the turn ended is ignored). `tool.call` is the only request a provider sends; its ids are provider-minted. Fixture: `fixtures/v1/client-tools.json`; the Rust mirror must add the optional field, the provider request envelope and its result in the same change.
- Additive capability names (`ADDITIVE_BOOLEAN_CAPABILITIES` in `src/v1/capabilities.ts`): `orchestration.tools` (the provider registers `clientTools` and calls back with `tool.call`) and `threads.crossProviderFork` (a thread of the provider can be forked into, or receive a fork from, another provider's thread). A declaration may omit them (unsupported); the shape check accepts both forms, and the handshake fixture carries them because the Rust mirror always serializes them.
- Provider health (`src/v1/providers.ts`) — added within v1. The provider → companion notification `account.updated {account: ProviderAccount}` reports a sign-in change after `initialize` (fixture `fixtures/v1/account-updated.json`; Rust mirror `AccountUpdatedNotification` in `operations.rs`); `ProviderAccount.accountLabel` (optional) is the signed-in email or organization, shown to the user and never logged. The notification `rateLimits.updated {rateLimits: ProviderRateLimits}` carries a provider's full merged subscription limit snapshot (fixture `fixtures/v1/rate-limits-updated.json`; Rust mirror `RateLimitsUpdatedNotification`); `AgentProviderEntry` lists it as the optional `rateLimits` (and the optional `accountLabel`), both omitted for a provider that reports neither. The same file types the companion's client-wire read `companion/agentProviders/read` / notification `companion/agentProviders/changed` (`AgentProvidersReadResult`) and the `model/list` extension `codewideAgentProvidersUnavailable`; the producer is `crates/companion-core/src/agent/provider_status.rs` and the client reader `apps/android/src/data/agentProviders.ts`.
- Usage additions within v1: `TokenUsage.cacheWriteInputTokens` (optional, absent means 0), the optional `cost: ProviderCost` on `usage.updated` (a provider's own estimate, sent only with a known price table), the optional `model` on `usage.updated` (the model that served `last`), the optional `prices` of `catalog.models` (model id → `ModelPriceEntry`) and the optional `AgentTurn.usage: TurnUsageRecord` on reads. Fixtures: `events.json`, `operations.json` (`thread.turns`).
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
