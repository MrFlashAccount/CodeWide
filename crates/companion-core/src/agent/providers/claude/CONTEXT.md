# Claude provider adapter

## Purpose and owner

The `AgentProvider` implementation for Claude. It owns the sidecar configuration (`providers.claude` in `agent-providers.json`), launches and supervises the `apps/claude-sidecar` child, and speaks `codewide-agent` v1 JSON-RPC over stdio, reusing the `upstream.rs` JSONL framing through a supervised constructor. It forwards trait calls 1:1; protocol semantics live in the sidecar and [`packages/agent-protocol`](../../../../../../packages/agent-protocol/CONTEXT.md). Code owner: backend. This document: architect. Layer contract: [`../../CONTEXT.md`](../../CONTEXT.md).

## Module jobs

- `mod.rs` — `ClaudeProvider`: sidecar launch, supervision and 1:1 forwarding of trait calls over stdio JSON-RPC.
- `config.rs` — validation of the `providers.claude` entry. `agent/providers/mod.rs` hands the entry to it and spawns the adapter; `registry.rs` treats the entry as opaque.

Claude declares `threads.hostMintedIds` and not `threads.externalDiscovery`: every Claude thread is bound at `thread/start` (companion-minted UUIDv7), and this adapter is never asked to discover or backfill thread ids.

## Boundary

- Must not import the Codex storage modules (`history_service`, `history`, `rollout`, `rollout_monitor`, `catalog`, `catalog_visibility`, `resources`, `message_search`, `account_pool`, `usage`).
- Never emits client-wire JSON and never shapes ids for the client; `agent/client_wire` does that (`wire-request-ids-v0`).
- Does not read, store, forward or log Claude credentials, tokens, `ANTHROPIC_*` values or `~/.claude` contents.

## Install and configuration contract

- Config entries are absolute paths: `runtimeExecutable`, `sidecarEntry`, `claudeExecutable`; plus `journalDirectory` and `idleReleaseMinutes` (5–240, default 30).
- An invalid entry disables Claude with one `error` log carrying the full `err`; Codex is unaffected.
- Removing `providers.claude` disables Claude: calls on Claude threads return `-32070`; bindings and the journal stay.
- `scripts/install-claude-provider.sh` installs the sidecar and writes this config; a systemd drop-in is added only if E-HARDEN requires it, for the companion unit only (outcome recorded in [`docs/agent-providers.md`](../../../../../../docs/agent-providers.md#pending-host-evidence)).

## Supervision and failure

- Sidecar not live → transport `UpstreamError::Reconnecting` (the outbox retries); a direct RPC gets `-32003`.
- A sidecar restart resolves only Claude's pending user-interaction requests; the restarted sidecar finalizes the open turn as interrupted.
- No live-session cap. A killed `claude` process fails only its own turn.
- More than 5 sidecar restarts in 10 min is a rollback trigger.
