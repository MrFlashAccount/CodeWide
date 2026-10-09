# Agent protocol (`codewide-agent` v1)

## Purpose and owner

This package is the source of truth for the neutral companion ↔ provider protocol: TypeScript types for the neutral model (threads, turns, items, runtime requests), events, operations, branded ids and the capability vocabulary, plus versioned round-trip fixtures. The cross-zone contract is described in [`docs/agent-providers.md`](../../docs/agent-providers.md).

Code owner: backend. This document: architect.

## What belongs here

- `src/v1/**` — the v1 neutral model, operations, events and capability names. Discriminated unions with literal discriminators; `readonly` fields; branded ids for `ProviderId`, `AppThreadId`, `ProviderThreadRef`, `TurnId`, `ItemId`, `RuntimeRequestId`, `ClientMessageId`.
- `CodewideAgentThreadExtension` (`src/v1/capabilities.ts`) — the shape of the client-wire field `Thread.codewideAgent {provider, providerName, primary, capabilities}`. The companion attaches it, and the `codewideAgentProvider` / `codewideAgentProviders` catalog annotations, only when more than one provider is enabled; a thread without it is a legacy Codex thread with every capability. The Rust producer is `crates/companion-core/src/agent/client_wire/mod.rs`.
- `fixtures/v1/*.json` — shared fixtures that both this package and the Rust mirror (`crates/companion-core/src/agent/model/`) must round-trip unchanged. The fixtures are the protocol's compatibility contract and are owned here, not by consumers.

Does not belong: provider-specific behavior, Codex client-wire shapes, SDK types, transport framing, runtime code with side effects.

## Version policy

- Changes within v1 are additive only (new optional fields, new union members that consumers may ignore, new capability names).
- A breaking change creates `src/v2/**` and `fixtures/v2/**`; `initialize` negotiates the version. A mismatch disables that provider with the `error` log "agent protocol version mismatch".
- A fixture changes only together with a deliberate protocol change in this package and the Rust mirror in the same change.

## Dependency rules

- This package depends on no other `@codewide/*` package and no provider SDK.
- Consumers import it type-only where they have no runtime need (`apps/claude-sidecar` uses `import type`, so its `dist/` contains no `@codewide/` import).
- The client (`apps/android`, `packages/sync-client`, `packages/renderers`) does not import this package in phase 1; it speaks the Codex-shaped client wire and validates `codewideAgent` with its own reader (`apps/android/src/data/threadAgent.ts`), which must stay compatible with `CodewideAgentThreadExtension`.

## Validation

`pnpm --filter @codewide/agent-protocol test` and the Rust fixture round-trip in `pnpm test:companion`.
