# Agent provider layer

Status: **approved phase-1 contract; implementation in progress**. Host integration experiments (E-HARDEN, E-PERM-RO, E-STEER-UUID, E-INT-TOOL, E-STEER-WAKE) and the idle-memory load measurement are not yet recorded; their sections below say so explicitly.

The companion talks to coding agents only through a provider layer: one provider trait, one neutral model and declared capabilities. Codex and Claude are two equal providers. Every thread is bound to exactly one provider for its whole life. The client keeps its Codex-shaped wire (protocol `0.155.1` shapes) in phase 1; the companion translates neutral → client wire in exactly one place, and the client hides features that the thread's provider does not declare.

Local ownership rules live with their source zones; this document routes to them and records the cross-zone contract:

- [`packages/agent-protocol/CONTEXT.md`](../packages/agent-protocol/CONTEXT.md) — the `codewide-agent` protocol contract, version policy and fixtures.
- [`crates/companion-core/src/agent/CONTEXT.md`](../crates/companion-core/src/agent/CONTEXT.md) — provider layer bounded context, no-go imports, compatibility surfaces.
- [`crates/companion-core/src/agent/providers/codex/CONTEXT.md`](../crates/companion-core/src/agent/providers/codex/CONTEXT.md) — Codex adapter, Codex-owned storage modules, `codex.native`.
- [`crates/companion-core/src/agent/providers/claude/CONTEXT.md`](../crates/companion-core/src/agent/providers/claude/CONTEXT.md) — sidecar supervision boundary and install contract.
- [`apps/claude-sidecar/CONTEXT.md`](../apps/claude-sidecar/CONTEXT.md) — neutral-protocol server over the Claude Agent SDK.
- [`docs/thread-catalog-pagination-regression.md`](thread-catalog-pagination-regression.md#multi-provider-pages) — multi-provider `thread/list` pages and the composite cursor.

## Scope

Phase 1 delivers the provider layer in `crates/companion-core`, the neutral protocol package, the Codex adapter as a refactor of today's paths, the Claude sidecar, binding backfill, capability delivery to the client and the minimal client change set (provider at `thread/start`, same-provider model filter, capability gating, provider badge, approval title, neutral wording).

Not in phase 1:

- switching the provider inside a thread and context handoff (phase 2; bindings and the neutral model keep room for it);
- migrating the client to the neutral protocol;
- moving the Codex storage modules to new paths;
- Claude fork, review, goals, background terminals, realtime voice, global supervisor, message search and thread resources;
- any Claude account pool, rate limits, pricing or credential handling;
- bundling the Claude Agent SDK into CodeWide binaries.

## Shape

```text
Android (Codex-shaped client wire, capability gating)
  └─ /v1 sync ─ SyncHub (sessions, outbox, ingest)
       └─ agent/client_wire  — the only neutral ↔ client-wire translation
            └─ agent/registry + agent/bindings — routing by binding and capability
                 ├─ AgentProvider ─ agent/providers/codex  ─ Codex App Server (in-process adapter)
                 └─ AgentProvider ─ agent/providers/claude ─ codewide-agent v1 over stdio
                                                              └─ apps/claude-sidecar ─ Agent SDK ─ user's claude CLI
```

The registry is built by `agent/providers/mod.rs` (`build_registry`), the only code outside an adapter folder that maps configured provider ids to adapters.

Forbidden edges: provider-id branches in `client_wire` or SyncHub; `registry`, `bindings` or `client_wire` importing `agent/providers/*`; SyncHub (`sync.rs`, `sync/*`, `thread_view.rs`, `sync_pending.rs`) importing Codex storage (`history_service`, `resources`, `account_pool`, `rollout`, `catalog`, `catalog_visibility`, `message_search`) instead of using the `NativeSurface` storage traits of the capability owner; the Claude adapter reaching Codex storage; the client reaching the sidecar directly.

## Ubiquitous language

- **Provider** — an agent backend implementing `AgentProvider` (`codex`, `claude`; the `ProviderId` set is open).
- **Primary provider** — the configured provider that leads `thread/list` pagination, owns the single default model row and whose threads carry no badge.
- **Binding** — the companion-owned record that fixes a thread's provider.
- **Capability** — a declared, named feature of a provider; the only basis for routing differences and client gating.
- **Neutral model** — the `codewide-agent` v1 types: thread, turn, item, runtime request, events and operations.
- **Client wire** — the existing Codex-shaped v0.155.1 protocol the client speaks in phase 1.
- **Wire projector** — `agent/client_wire`, the single neutral → client-wire translation and client-wire → neutral decoder.
- **Wake turn** — a turn with `origin: provider`, started by the provider without a user message.
- **Busy start** — the `turn.start` outcome `busy {activeTurnId}` for a provider whose thread is already active.

## Neutral protocol `codewide-agent` v1

`packages/agent-protocol` is the source of truth (TypeScript types, capability vocabulary, versioned fixtures). Rust mirrors it with serde under `crates/companion-core/src/agent/model/`; both must round-trip every fixture. Ids are branded in both languages: `ProviderId`, `AppThreadId`, `ProviderThreadRef`, `TurnId`, `ItemId`, `RuntimeRequestId {provider, nativeId}`, `ClientMessageId`.

The model covers `AgentThread`, `AgentTurn` (`origin: user | provider`), the `AgentItem` discriminated union, `RuntimeRequest` (`approval`, `userInput`, `capabilityRequest`), events (`thread.updated`, `turn.*`, `item.*`, `request.*`, `usage.updated`, `plan.updated`, `diff.updated`, `capability.event`) and operations (`initialize`, catalogs, `thread.*`, `turn.start | steer | interrupt`, `request.respond`, `capability.invoke`). The exact shapes are owned by the package, not by this document.

Ordering rules every provider keeps:

- `turn.started` precedes any item of that turn;
- a `userMessage` is the first item of a user-origin turn;
- every started item is completed before `turn.completed`;
- at most one `agentMessage` with phase `final` per turn;
- `item.completed` carries full content.

Version policy: changes within v1 are additive only. A breaking change bumps the version and `initialize` negotiates it; a mismatch disables that provider with the `error` log "agent protocol version mismatch".

## Thread bindings

Every thread has an explicit binding, Codex threads included. "No binding means Codex" is never a rule.

- Record: versioned `v:1`, redb table `agent_thread_bindings`, fields `appThreadId`, `activeProvider`, `refs {provider → ProviderThreadRef}`, `origin: created | discovered | backfilled`, `createdAtMs`.
- Phase-1 invariants: exactly one ref; it equals `appThreadId`; `activeProvider` never changes.
- Writers, independent of provider identity:
  - **create** — `thread/start` names a provider in `codewideAgentProvider` (absent or `null` → the primary provider, for older clients; an invalid id → `-32602 "codewideAgentProvider is invalid"`); the companion mints a UUIDv7 `AppThreadId` for providers declaring `threads.hostMintedIds`, otherwise takes the provider-minted id; the binding is written before the response;
  - **backfill** — one-time job `agent_bindings_backfill_v1` (durable progress marker per provider) for every provider declaring `threads.externalDiscovery`; pages non-archived then archived threads through the neutral `thread.list` (the Codex adapter asks for all source kinds, state-DB only), 100 rows per page; restart-safe and duplicate-free. It runs only when the companion is in active mutation mode, starts 30 s after companion startup and then waits until the provider is live;
  - **observation** — every listed row and every `thread.updated` upserts its binding;
  - **discovery on a miss** — a thread id without a binding:
    - exactly one provider declares `threads.externalDiscovery` → the call is routed provisionally to that provider without an extra `thread.owns` call; the `discovered` binding is written only after the provider accepts the call, so a rejected call leaves no binding and the provider's own error reaches the client;
    - several providers declare it → each is asked in registry order via `thread.owns`; the first owner gets a `discovered` binding before the call is routed;
    - no provider declares it, or none owns the id → `-32600 "thread not found: <id>"`.
- An upsert never changes an existing binding's provider. A conflicting claim is logged at `error` and ignored.
- `thread_metadata.model_provider`, model ids and id shape are never used for routing.

## Capabilities

Each provider declares its capability set at `initialize`. The registry indexes them.

Client-wire extensions are attached only when more than one provider is enabled (`ProviderRegistry::is_multi_provider`). A Codex-only host therefore keeps today's client wire byte-for-byte. In multi-provider mode:

- every projected `Thread` — RPC results (`result.thread`, `thread/list` and `companion/supervisor/threadList` rows), `thread/started`, and durable replay of notifications projected in this mode — carries `Thread.codewideAgent {provider, providerName, primary, capabilities}`: the bound provider id, its display name (badge text only), whether it is the primary provider (no badge) and its declared capability set. The TypeScript shape is `CodewideAgentThreadExtension` in `packages/agent-protocol`;
- `model/list` and `permissionProfile/list` carry the `codewideAgentProvider` / `codewideAgentProviders` annotations described below.

A thread without `codewideAgent` (single-provider or legacy companion) is treated by the client as a Codex thread with every capability.

| Capability | Codex | Claude |
|---|---|---|
| `turns.steer` | yes | yes |
| `turns.startWhileActive` | `nativeJoin` | `busy` |
| `turns.providerInitiated` | no | yes |
| `threads.hostMintedIds` | no | yes |
| `threads.externalDiscovery` | yes | no |
| `threads.compact` | yes | yes |
| `threads.fork` | yes | no |
| `requests.userInput` | yes | yes |
| `requests.mcpElicitation` | yes | no |
| `requests.dynamicToolCall` | yes | no |
| `settings.serviceTier` | yes | no |
| `settings.personality` | yes | no |
| `input.skillsAndMentions` | yes | no |
| `catalog.skillsPlugins` | yes | no |
| `review` | yes | no |
| `goals` | yes | no |
| `backgroundTerminals` | yes | no |
| `realtimeVoice` | yes | no |
| `globalSupervisor` | yes | no |
| `subagentThreads` | yes | no |
| `accounts.pool` | yes | no |
| `accounts.rateLimits` | yes | no |
| `history.threadResources` | yes | no |
| `history.messageSearch` | yes | no |
| `host.fs` | yes | no |
| `codex.native` | yes | no |

Routing and degradation, by capability only:

- A thread-scoped call resolves the binding (discovery first), then requires the capability its client-wire method maps to. Missing → `-32072 "<capability> is not supported by this thread's agent"` with `data {capability, provider}`, without contacting the provider.
- A connection-scoped call (`config/read`, `fs/*`, `skills/list`, `plugin/*`, realtime start, account methods) goes to the registry's owner of the matching host capability (`host.fs`, `host.config`).
- `model/list` in multi-provider mode: every row carries `codewideAgentProvider`; the first page appends other providers' rows after the primary provider's rows; exactly one `isDefault` (the primary's); at most 100 rows; a duplicate model id keeps the earlier provider's row. Non-primary rows are labelled `"<Provider> · <displayName>"`. With one provider the response is unchanged.
- `permissionProfile/list` in multi-provider mode: every row carries `codewideAgentProviders` (the providers offering it); profiles offered only by non-primary providers are appended. With one provider the response is unchanged.
- Thread pins are companion state, not agent storage: `thread_pins.rs` stores them in the companion store and SyncHub annotates `codewide.threadPin {version, pinned, cursor}` on `result.thread` and on `thread/list` / `companion/supervisor/threadList` rows of every provider; a pin read failure returns `-32020 "Thread pin projection unavailable"`.
- Clients decide features only from `codewideAgent.capabilities`, never from model ids or provider names. The provider name is used only as badge text.

## Delivery, steer and interrupt

- Neutral `turn.start` never steers implicitly. A provider whose thread is active and declares `turns.startWhileActive: busy` returns `busy {activeTurnId}`; the companion puts that outbox command back in the queued state ("deliver after idle") and redelivers it once on that thread's `turn.completed`. The client sees an ordinary queued item through `companion/queue/changed`.
- `nativeJoin` (Codex) keeps today's App Server behavior: the adapter reports `started` with the joined turn id, so Codex wire behavior is unchanged.
- Steer is only an explicit `turn.steer {expectedTurnId}`; a mismatch returns `-32600 "expected turn is not active"`.
- `turn.interrupt` answers `{}` within 1 s when a turn is active, already interrupted, completed or the thread is idle; it errors only for a foreign `turnId` during an active turn or an unknown thread. Open requests resolve with `request.resolved` before `turn.completed`. Repeats never hang.

## Error codes

- `-32070 "<Provider> provider is disabled on this host"` — terminal (`Rejected`, then `Failed`).
- `-32072 "<capability> is not supported by this thread's agent"`, `data {capability, provider}`.
- `-32020 "Thread binding is unavailable"` — the binding store could not be read or written while resolving a thread-scoped call (logged at `warn` with `err`).
- Sidecar not live → transport `UpstreamError::Reconnecting` (outbox retries); a direct RPC gets the existing `-32003`.
- `-32071` is not used: there is no session cap.

## Compatibility surfaces

| Surface | Decision | Owner | Removal condition | Negative check |
|---|---|---|---|---|
| `codex.native` — Codex notifications and request params without a neutral or capability mapping pass through unchanged as `capability.event` or `providerOptions["codex.native"]` | `keep_temporarily` | backend | every Codex method the client uses has a neutral or capability mapping and the client speaks the neutral protocol | no other provider emits it; the projector drops `providerOptions` for capabilities the target provider lacks (logged at `debug`) |
| Codex storage modules stay in place: `history_service`, `history`, `rollout`, `rollout_monitor`, `catalog`, `catalog_visibility`, `resources`, `message_search`, `account_pool`, `usage` | `keep_temporarily` | backend | moved under `agent/providers/codex/` in a later slice | none of them is imported from `agent/` outside `providers/codex/`; SyncHub reaches history, message search and resources only through the `NativeSurface` storage traits (`agent/provider/native_storage.rs`), implemented by `CodexStorage` (`providers/codex/storage.rs`); the remaining direct use is `usage` in SyncHub ingest (`LiveUsageProjector`, `prepare_replay_payload`) |
| `wire-request-ids-v0` — primary-provider runtime request ids are emitted unchanged (the client persists them); other providers' ids are emitted as `"cw-<provider>:" + JSON(nativeId)`; a primary-provider string id starting with `cw-` is rejected and logged | `keep_temporarily` | backend | the client moves to the neutral protocol | non-primary ids always carry the prefix; a reconnect of one provider resolves only that provider's user-interaction requests |

## Claude provider

- **Process model.** The Claude adapter (Rust) supervises one Node sidecar child and speaks `codewide-agent` v1 JSON-RPC over stdio. The sidecar opens one Agent SDK query per live session against the user's own `claude` CLI.
- **Session lifecycle.** `Shell` (hidden from the non-archived list until the first user message) → `Active` ↔ `Idle` → `Released` (idle release) → resumed on the next turn; a lost session is recovered with a new session id and a bounded transcript prefix (up to 16 KiB under `[Historical conversation from this thread]`); a second loss in the same turn fails it.
- **Idle release.** After 30 min without activity (configurable 5–240 min); never while a turn is active or a request is pending; background tasks defer release up to 4 h.
- **No session cap.** One idle `claude` process costs about 125 MB PSS (research probe P2), and idle release bounds the steady state. Without a cap, a host-killed `claude` process fails only its own active turn ("Claude process exited unexpectedly"); its open requests resolve, the session becomes `Released` and the next turn resumes it. The sidecar logs its live session count at `info` on every open and release. The companion memory watch reads only the companion main PID, so sidecar children do not trigger its alerts.
- **Permission profiles.** `:read-only` restricts built-in tools to Read/Glob/Grep/LS, disables settings sources and MCP, and denies everything else in `canUseTool`; `:workspace` accepts edits with user/project/local settings and asks for the rest; only `:full-access`/`:danger-full-access` bypasses permissions; an unknown profile returns `-32602 "Unsupported permission profile for Claude: <id>"`.
- **Approval decisions.** `accept` → allow; `acceptForSession` → session-scoped permissions only (never a settings file); `decline` → deny; `cancel` → deny with interrupt. `canUseTool` never returns `null`; a decline or response error never becomes allow.
- **Credentials.** No CodeWide component reads, stores, forwards or logs Claude credentials, tokens or `~/.claude` contents. Auth state comes only from the SDK initialization result. Claude usage is unpriced.
- **Logs.** Full errors in `err`; opaque ids allowed; prompts, outputs, tool inputs and env values never logged.

### Install and configuration

- Host prerequisites: Node ≥ 22 (tested) or Bun (best-effort); the user installs and signs in to the `claude` CLI.
- Config file `<companion state dir>/agent-providers.json`: `version: 1`, `primary: "codex"`; `providers.claude` with absolute `runtimeExecutable`, `sidecarEntry`, `claudeExecutable`, plus `journalDirectory` and `idleReleaseMinutes`.
- File absent, unreadable or invalid → Codex only, built from the existing host flags (an unreadable or invalid file is logged once at `error`); the registry is still built and holds one provider. An invalid `providers.claude` entry or an unknown provider id → only that provider is disabled, with one `error` log.
- `registry.rs` parses the file with opaque per-provider entries; the mapping from a provider id to its adapter lives in `agent/providers/mod.rs` (`build_registry`), so the registry never imports an adapter.
- `apps/claude-sidecar/package.json` is the single SDK version source; the host lock check fails the sidecar tests on drift.
- `scripts/install-claude-provider.sh` copies `dist/`, installs host dependencies without optional packages or install scripts, writes the config and installs the systemd drop-in only if E-HARDEN requires it.

### Pending host evidence

- **E-HARDEN** — whether the sidecar and a Bash turn work under `codewide-companion.service` hardening. Outcome: *not yet recorded*. On failure, a backend drop-in relaxes only the proven properties, for the companion unit only.
- **Idle memory** — load run with 10 sessions (expected about 125 MB PSS each while idle, released after the idle timeout). Measurement: *not yet recorded*. It is not a pass threshold.
- **E-PERM-RO, E-STEER-UUID, E-INT-TOOL, E-STEER-WAKE** — SDK experiments gating the sidecar mapping. Fallbacks that keep the contract: steer without a uuid; release the session after an interrupt that hit a running tool.

## Rollback

- Triggers: any Codex golden-replay diff or Codex regression; a Claude permission bypass; more than 5 sidecar restarts in 10 min.
- **Disable Claude:** remove `providers.claude` from `agent-providers.json` and restart the companion. Claude models leave the picker, calls on Claude threads return `-32070`, queued Claude commands fail once, Claude rows leave the list. Bindings and the sidecar journal stay; nothing is deleted.
- **Revert the layer:** revert the C3 switch-over commit. The old single-upstream route returns. The binding table is ignored and needs no reverse migration.
