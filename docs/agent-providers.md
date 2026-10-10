# Agent provider layer

Status: **approved phase-1 contract; implementation in progress**. Host integration experiments (E-HARDEN, E-PERM-RO, E-STEER-UUID, E-INT-TOOL, E-STEER-WAKE) and the idle-memory load measurement are not yet recorded; their sections below say so explicitly.

The companion talks to coding agents only through a provider layer: one provider trait, one neutral model and declared capabilities. Codex and Claude are two equal providers. Every thread is bound to exactly one provider for its whole life. The client keeps its Codex-shaped wire (protocol `0.155.1` shapes) in phase 1; the companion translates neutral → client wire in exactly one place, and the client hides features that the thread's provider does not declare.

Local ownership rules live with their source zones; this document routes to them and records the cross-zone contract:

- [`packages/agent-protocol/CONTEXT.md`](../packages/agent-protocol/CONTEXT.md) — the `codewide-agent` protocol contract, version policy and fixtures.
- [`crates/agent-core/CONTEXT.md`](../crates/agent-core/CONTEXT.md) — the neutral model (Rust mirror), the `AgentProvider` trait, `NativeSurface` storage traits, neutral usage accounting, `wire-request-ids-v0`.
- [`crates/agent-search/CONTEXT.md`](../crates/agent-search/CONTEXT.md) — the stored-message full-text search schema and query shared by provider adapters (`companion/search`).
- [`crates/agent-resources/CONTEXT.md`](../crates/agent-resources/CONTEXT.md) — the provider-neutral thread resource model, projection and service shared by provider adapters.
- [`crates/companion-host/CONTEXT.md`](../crates/companion-host/CONTEXT.md) — narrow host contracts the companion hands to adapter crates.
- [`crates/companion-core/src/agent/CONTEXT.md`](../crates/companion-core/src/agent/CONTEXT.md) — provider layer bounded context in the companion (registry, bindings, client wire, crate graph), no-go imports, compatibility surfaces.
- [`crates/agent-provider-codex/CONTEXT.md`](../crates/agent-provider-codex/CONTEXT.md) — Codex adapter, Codex-owned storage modules, `codex.native`, Codex pricing.
- [`crates/agent-provider-claude/CONTEXT.md`](../crates/agent-provider-claude/CONTEXT.md) — Claude adapter (Rust): host supervision boundary and install contract.
- [`crates/agent-provider-claude/host/CONTEXT.md`](../crates/agent-provider-claude/host/CONTEXT.md) — the Claude agent host: neutral-protocol server over the Claude Agent SDK and Claude's session store.
- [`docs/thread-catalog-pagination-regression.md`](thread-catalog-pagination-regression.md#multi-provider-pages) — multi-provider `thread/list` pages and the composite cursor.

## Scope

Phase 1 delivers the provider layer (`crates/agent-core`, `crates/agent-transport`, `crates/companion-host`, the adapter crates and `crates/companion-core/src/agent`), the neutral protocol package, the Codex adapter as a refactor of today's paths, the Claude provider (Rust adapter plus the Claude agent host), binding backfill, capability delivery to the client and the minimal client change set (provider at `thread/start`, same-provider model filter, capability gating, provider badge, approval title, neutral wording).

Not in phase 1:

- switching the provider inside a thread — **dropped** (owner decision, see [Decision: no in-thread provider switching](#decision-no-in-thread-provider-switching)); fork into another agent and cross-provider subagents replace it;
- migrating the client to the neutral protocol;
- ~~moving the Codex storage modules to new paths~~ — done: they live in `crates/agent-provider-codex/src/`;
- native Claude fork (a Claude thread forks only into another provider, see [Fork into another agent](#fork-into-another-agent)), review, goals, background terminals, realtime voice, global supervisor, message search and thread resources;
- any Claude account pool (switching, login or removal), or credential handling (live Claude costs are API-rate estimates and finished turns carry the SDK's own estimate, see [Token usage and cost](#token-usage-and-cost)); Claude's sign-in and subscription limits are reported read-only (see [Provider status](#provider-status-companionagentprovidersread));
- bundling the Claude Agent SDK into CodeWide binaries.

## Shape

```text
Android (Codex-shaped client wire, capability gating)
  └─ /v1 sync ─ SyncHub (sessions, outbox, ingest)
       └─ agent/client_wire  — the only neutral ↔ client-wire translation
            └─ agent/registry + agent/bindings — routing by binding and capability
                 ├─ AgentProvider ─ crates/agent-provider-codex  ─ Codex App Server (in-process adapter)
                 │                   └─ rollout storage + index, message search ─ crates/agent-search
                 └─ AgentProvider ─ crates/agent-provider-claude ─ codewide-agent v1 over stdio (crates/agent-transport)
                                     ├─ Claude native index (state.redb tables, watcher), message search ─ crates/agent-search
                                     └─ host/ (Claude agent host) ─ Agent SDK ─ user's claude CLI
                                                                  └─ Claude's session store (session records)
```

The registry is built by `crates/companion-core/src/agent/providers/mod.rs` (`build_registry`), the only code outside an adapter crate that maps configured provider ids to adapters. The neutral types and the `AgentProvider` trait live in `crates/agent-core`; the JSONL/WebSocket transports, including the supervised stdio child (`spawn_supervised_stdio`), live in `crates/agent-transport`.

Forbidden edges: provider-id branches in `client_wire` or SyncHub; `registry`, `bindings` or `client_wire` depending on an adapter crate (`agent-provider-codex`, `agent-provider-claude`); SyncHub (`sync.rs`, `sync/*`, `thread_view.rs`, `sync_pending.rs`) reaching Codex storage in `crates/agent-provider-codex` (`history_service`, `resources`, `account_pool`, `rollout*`, `catalog*`, `message_search`) instead of the `NativeSurface` storage traits of the capability owner; `agent-core`, `agent-transport` or an adapter crate depending on `companion-core`; `agent-provider-claude` depending on `agent-provider-codex` or `companion-host`; the client reaching the Claude agent host directly.

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

`packages/agent-protocol` is the source of truth (TypeScript types, capability vocabulary, versioned fixtures). Rust mirrors it with serde under `crates/agent-core/src/model/`; both must round-trip every fixture. Ids are branded in both languages: `ProviderId`, `AppThreadId`, `ProviderThreadRef`, `TurnId`, `ItemId`, `RuntimeRequestId {provider, nativeId}`, `ClientMessageId`.

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

- Record: redb table `agent_thread_bindings`, versioned `v:2`: `appThreadId`, `origin: created | discovered | backfilled`, `createdAtMs` and ordered `segments [{provider, nativeThreadId, firstTurnOrdinal, lastTurnOrdinal | null, handoffRefs[]}]`. Each segment is one provider's native thread serving a contiguous run of the app thread's turns; the app thread id is the first segment's native id; routing uses the active (last) segment. The v1 fields (`activeProvider`, `refs {provider → ProviderThreadRef}`) are kept as a copy so a rolled-back companion still routes. v1 records are upgraded once (marker `agent_bindings_segments_v2`).
- Table `agent_thread_continuations`: native threads that are non-first segments of an app thread. Hiding rule: a continuation is never listed, searchable or addressable as its own thread.
- History of an app thread: its segments' native turns in segment order, a closed segment contributing at most its ordinal span (`assemble_history`). Turns and items carry optional `provenance {provider, nativeThreadId}`; adapters stamp it where absent.
- Invariants: exactly one segment; its native id equals `appThreadId`; the provider never changes. The segment model (`agent_thread_continuations`, `assemble_history`, `provenance`) stays as harmless groundwork; nothing writes a second segment, because in-thread switching is dropped.
- Writers, independent of provider identity:
  - **create** — `thread/start` names a provider in `codewideAgentProvider` (absent or `null` → the primary provider, for older clients; an invalid id → `-32602 "codewideAgentProvider is invalid"`); the companion mints a UUIDv7 `AppThreadId` for providers declaring `threads.hostMintedIds`, otherwise takes the provider-minted id; the binding is written before the response;
  - **backfill** — one-time job `agent_bindings_backfill_v1` (durable progress marker per provider) for every provider declaring `threads.externalDiscovery` (Codex and Claude); pages non-archived then archived threads through the neutral `thread.list` (the Codex adapter asks for all source kinds, state-DB only; Claude lists its own and terminal-started sessions), 100 rows per page; restart-safe and duplicate-free. It runs only when the companion is in active mutation mode, starts 30 s after companion startup and then waits until the provider is live;
  - **observation** — every listed row and every `thread.updated` upserts its binding;
  - **discovery on a miss** — a thread id without a binding:
    - exactly one provider declares `threads.externalDiscovery` → the call is routed provisionally to that provider without an extra `thread.owns` call; the `discovered` binding is written only after the provider accepts the call, so a rejected call leaves no binding and the provider's own error reaches the client;
    - several providers declare it (Codex and Claude) → each is asked in registry order via `thread.owns` (Codex, then Claude; Claude answers from its native index first, then from the host); the first owner gets a `discovered` binding before the call is routed;
    - no provider declares it, or none owns the id → `-32600 "thread not found: <id>"`.
- An upsert never changes an existing binding's provider. A conflicting claim is logged at `error` and ignored.
- `thread_metadata.model_provider`, model ids and id shape are never used for routing.

## Capabilities

Each provider declares its capability set at `initialize`. The registry indexes them.

Client-wire extensions are attached only when more than one provider is enabled (`ProviderRegistry::is_multi_provider`). A Codex-only host therefore keeps today's client wire byte-for-byte. In multi-provider mode:

- every projected `Thread` — RPC results (`result.thread`, `thread/list` and `companion/supervisor/threadList` rows), `thread/started`, and durable replay of notifications projected in this mode — carries `Thread.codewideAgent {provider, providerName, primary, capabilities}`: the bound provider id, its display name (badge text only), whether it is the primary provider (no badge) and its declared capability set. The TypeScript shape is `CodewideAgentThreadExtension` in `packages/agent-protocol`;
- `model/list` and `permissionProfile/list` carry the `codewideAgentProvider` / `codewideAgentProviders` annotations described below.

A thread without `codewideAgent` (single-provider or legacy companion) is treated by the client as a Codex thread with every capability. A `codewideAgent` that is present but malformed is not legacy: the client reads it as an agent with no capabilities (provider unknown when its id is unusable) and logs it once (`thread_agent.descriptor.malformed`).

| Capability | Codex | Claude |
|---|---|---|
| `turns.steer` | yes | yes |
| `turns.startWhileActive` | `nativeJoin` | `busy` |
| `turns.providerInitiated` | no | yes |
| `threads.hostMintedIds` | no | yes |
| `threads.externalDiscovery` | yes | yes |
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
| `subagentThreads` | yes | yes (with host storage: sub-agent transcripts as read-only child threads) |
| `accounts.pool` | yes | no |
| `accounts.rateLimits` | yes | no (provider-level limits instead, see below) |
| `history.threadResources` | yes | yes (with host storage) |
| `history.messageSearch` | yes | yes (with host storage: the Claude native index) |
| `host.fs` | yes | no |
| `codex.native` | yes | no |
| `orchestration.tools` | yes (`dynamicTools`) | yes when the host declares it (`clientTools`) |
| `threads.crossProviderFork` | yes | yes (added by the adapter) |

Routing and degradation, by capability only:

- A thread-scoped call resolves the binding (discovery first), then requires the capability its client-wire method maps to. Missing → `-32072 "<capability> is not supported by this thread's agent"` with `data {capability, provider}`, without contacting the provider.
- A connection-scoped call (`config/read`, `fs/*`, `skills/list`, `plugin/*`, realtime start, account methods) goes to the registry's owner of the matching host capability (`host.fs`, `host.config`).
- `model/list` in multi-provider mode: every row carries `codewideAgentProvider`; the first page appends other providers' rows after the primary provider's rows; exactly one `isDefault` (the primary's); at most 100 rows; a duplicate model id keeps the earlier provider's row. Non-primary rows are labelled `"<Provider> · <displayName>"`. With one provider the response is unchanged.
- `permissionProfile/list` in multi-provider mode: every row carries `codewideAgentProviders` (the providers offering it); profiles offered only by non-primary providers are appended. With one provider the response is unchanged.
- Missing catalogs (multi-provider mode only): when a non-primary provider is not live or its catalog call fails, the first `model/list` page and every `permissionProfile/list` result carry `codewideAgentProvidersUnavailable: [providerId]` (absent when every provider answered). The client does not treat such a catalog as fresh: it keeps that provider's previously cached rows and refreshes again on the next load. A Codex-only host never adds the field.
- Account limits: `accounts.rateLimits` means the Codex account-pool limit wire (`account/rateLimits/read`, `account/rateLimits/updated`, `companion/accountPool/*`). The client shows pool account rows and reads the account pool in a thread's header only when the thread's provider declares it (a legacy thread keeps them). In multi-provider mode the account section is titled with the pool owner's provider name ("Codex accounts").
- Provider-level subscription limits without an account pool are not a capability: a provider entry of `companion/agentProviders/read` carries `rateLimits` (null until the first report) exactly when the provider reports them (Claude, from the SDK's `rate_limit_event` frames and its usage read). The client shows them in that provider's account row and in the usage menu of its threads' header ("unknown" until the first report); other threads keep their context usage only.

### Provider status: `companion/agentProviders/read`

- `companion/agentProviders/read {}` (answered in every mode) → `AgentProvidersReadResult` (`packages/agent-protocol/src/v1/providers.ts`; producer `crates/companion-core/src/agent/provider_status.rs`):

  ```text
  {providers: [{id, name, primary, status: live | reconnecting | unavailable | disabled,
                auth: authenticated | unauthenticated | unknown, planLabel: string | null,
                accountLabel?: string, rateLimits?: ProviderRateLimits | null,
                capabilities: CapabilitySet | null}],
   hostCapabilities: {<boolean capability>: bool}}
  ```

  Enabled providers come in registry order (primary first), then disabled ids (`capabilities: null`). `status` combines the transport (`ProviderStatus`: live, reconnecting) with the provider's health (`ProviderHealth::Unavailable`, for example a protocol version mismatch). `auth`, `planLabel` and `accountLabel` come from `ProviderHealth::Available(ProviderAuth)`; a provider that reports nothing (Codex) is `unknown`. `accountLabel` (the signed-in email, else organization) is present only while signed in with a reported label; `rateLimits` is present only for a provider whose adapter reports provider-level limits (`AgentProvider::subscribe_rate_limits`), so a Codex-only read result keeps its earlier bytes. `hostCapabilities` names every boolean capability with `true` when some enabled provider declares it, so connection-scoped features (global voice mode: `realtimeVoice`) are known without probing for `-32072`; the client keeps the `-32072` handling as fallback.
- `companion/agentProviders/changed` — a durable journal notification whose params are the full read result, emitted only in multi-provider mode whenever a provider's status, sign-in state, capabilities or subscription limits change. A Codex-only journal is unchanged (its status keeps reaching the client as the session `status` frame).
- The client shows the list in the server detail screen as provider status ("Claude · signed in · Max", "Claude · not signed in — run `claude` on the server to sign in"), and a provider without an account pool as a read-only account row in Accounts under its own section ("Claude": "Signed in via Claude Code on <server>" with the account label and plan, or "Not signed in — run `claude` on the server"; no switching, login or removal), only when the server lists more than one provider. A companion without the method answers `-32601`; the client records it as unsupported and renders as before.
- Sign-in state never carries credentials: the Claude host derives `{authenticated, label, accountLabel?}` (label = the plan type; accountLabel = the email, else organization, of an Anthropic login, shown like a Codex pool account's email and never logged) from the SDK initialization result of its probe; `initialize` carries it, and every later change is sent as the neutral notification `account.updated {account}` (fixture `fixtures/v1/account-updated.json`).
- Subscription limits: the provider → companion notification `rateLimits.updated {rateLimits: ProviderRateLimits}` (fixture `fixtures/v1/rate-limits-updated.json`) always carries the provider's full merged snapshot `{updatedAt, windows: [{id, kind: session | weekly | other, label, windowDurationMins, usedPercent (integer 0–100) | null, resetsAt (Unix seconds) | null, status: allowed | warning | rejected | null}]}`, ordered session, weekly, then other ids. The Claude host (`src/account/rateLimitReporter.ts`, mapping `src/mapping/rateLimits.ts`) merges windows by id from `rate_limit_event` frames (`rateLimitType` names the window; most frames carry only a status and are ignored) and from the SDK's experimental usage read, taken by the probe and at most once per two minutes through a live query after a result; a failed or unsupported usage read changes nothing. The Rust adapter keeps the latest snapshot; the companion lists it on the entry. The host probes again (at most once per minute) on `catalog.models` while signed out, so a sign-in on the server reaches the client without a restart.
- Thread pins are companion state, not agent storage: `thread_pins.rs` stores them in the companion store and SyncHub annotates `codewide.threadPin {version, pinned, cursor}` on `result.thread` and on `thread/list` / `companion/supervisor/threadList` rows of every provider; a pin read failure returns `-32020 "Thread pin projection unavailable"`.
- Clients decide features only from `codewideAgent.capabilities`, never from model ids or provider names. The provider name is used only as badge text.

## Decision: no in-thread provider switching

Owner decision: a thread never changes its provider. Switching inside a thread (the former phase 2: more binding segments plus a context handoff on every switch) is dropped. Two features replace it:

- **Fork into another agent** — the user forks a thread into a new thread on another provider; the new thread starts from a context handoff and the source thread is unchanged.
- **Cross-provider subagents** — the model of any thread starts, waits for, messages, cancels and lists agents on any enabled provider through companion-owned orchestration tools.

The tools reach the model as **native client-side tools over the existing provider channels** (Codex `dynamicTools` / `item/tool/call`, the Claude host's `clientTools` / `tool.call`), not through an MCP server or an HTTP endpoint: no extra process, port, token or auth surface; the caller's identity is the channel that carried the call and the thread it names (which must be bound to that channel's provider), never a credential in the arguments.

## Orchestration tools

Declared by the companion, identical for every provider (`crates/companion-core/src/agent/orchestration/tools.rs`). Results are JSON text content (the JSON-encoded result object); failures are unsuccessful tool results (`success: false` with a clear message), never JSON-RPC errors.

| Tool | Arguments | Result |
|---|---|---|
| `codewide_spawn_agent` | `{prompt, provider?, model?, name?, cwd?, permissionProfile?}` | `{agentThreadId, provider, model, status: "running"}` |
| `codewide_wait_agent` | `{agentThreadId, timeoutSeconds?}` (default 60, clamped to 300) | `{status: "running" \| "completed" \| "failed" \| "interrupted", finalMessage?, turnId?}` |
| `codewide_send_agent` | `{agentThreadId, message, mode?: "queue" \| "steer"}` (default `queue`) | `{status: "running" \| "queued"}` |
| `codewide_cancel_agent` | `{agentThreadId}` | `{status}` |
| `codewide_list_agents` | `{}` | `{agents: [{agentThreadId, provider, model, name \| null, status \| null}]}` |

- **Spawn** creates a new app thread on `provider` (default: the caller's) through the neutral `thread.create`, writes its `created` binding and a durable link to the calling thread (`agent_subagent_children` / `agent_subagent_parents`), and starts its first turn with `prompt` only — the caller's history is not copied. `model` defaults to the caller's on the same provider, else the target's default model; `cwd` to the caller's. Returns at once.
- **Permission non-escalation**: the child's profile defaults to the caller's and never exceeds it (`:read-only` < `:workspace` < `:full-access` < `:danger-full-access`); escalation is a tool error. The caller's profile comes from its neutral settings, else from the client wire (`thread/start|resume|fork` results, `thread/settings/updated`); when unknown (a Codex thread not observed since start) only `:read-only` is allowed — fail closed. A custom parent profile allows only itself or `:read-only`.
- **Status** comes from the child's turn lifecycle on the client wire (`turn/started`, `item/completed` agent messages, `turn/completed`), observed for every provider in the hub's event forwarder; the final message is the turn's `final_answer` agent message, else its last agent message, else its error. After a companion restart an agent's state is read once from its provider (`thread.read`, last `thread.turns`).
- **Wait** subscribes to the child's state and wakes on the event that settles its turn — no polling. It never blocks longer than its timeout and also ends when the **calling** turn ends (the provider abandons the call; a late answer is ignored).
- **Send** follows client defaults: `queue` starts a turn when the child is idle and otherwise delivers the message after the running turn (a `busy` start re-queues it); `steer` is only explicit and needs the running turn. The queue is in memory: queued messages do not survive a companion restart.
- **Cancel** interrupts the running turn and drops queued messages; repeats on an idle agent only report its status.
- **Scope**: a tool addresses only children of the calling app thread; anything else is `agent not found: <id>`.
- **Surfaces**: spawned agents are ordinary threads (listed, openable) and are added to `companion/threadSubagents/read` of their parent (descendants included) in the indexed-subagent row shape, also for parents whose provider lacks `subagentThreads`. Their tool calls render in the parent as `dynamicToolCall` items with the bare tool name.
- A passive (read-only shadow) companion declares no tools.

### Codex wiring

- `thread/start` requests that CodeWide sends (client pass-through and neutral `thread.create`) gain `dynamicTools: [{type: "function", name, description, inputSchema}]` (App Server 0.155.1 `DynamicToolSpec`; `dynamicTools` is an experimental field, accepted because the companion initializes with `experimentalApi: true`). Other requests are forwarded unchanged.
- `thread/resume` and `thread/fork` cannot declare dynamic tools. Codex persists `dynamic_tools` in the rollout session meta and (inferred, not verified against App Server source) restores them on resume; threads started before this change have no orchestration tools.
- The server request `item/tool/call {threadId, turnId, callId, namespace, tool, arguments}` for a declared tool with `namespace: null` is answered by the companion with `{contentItems: [{type: "inputText", text}], success}` and never reaches the client; its `serverRequest/resolved` is dropped too. Every other `item/tool/call` keeps today's path. With the tools installed, the recorded golden stream stays byte-identical (`codex_golden_tests`, `codex_tools_tests`).

### Claude wiring (`codewide-agent` v1, additive)

- `thread.create` and `turn.start` params carry optional `clientTools: ClientToolSpec[]` (`{name, description, inputSchema}`; absent keeps the set, present replaces it, `[]` clears it). The host keeps them only in process, so the adapter sends them on **every** `turn.start` while the host declares `orchestration.tools`.
- Host → companion request `tool.call {appThreadId, turnId, callId, tool, arguments}` → `{success, content: [{type: "text", text}]}` on the same stdio channel; malformed params get `-32602`. The Rust mirror is `crates/agent-core/src/model/tools.rs`; fixture `fixtures/v1/client-tools.json`.

## Fork into another agent

- `thread/fork` accepts optional `codewideAgentProvider` and `model` (and `codewideInitialPrompt`). Without `codewideAgentProvider` the request and behavior are exactly today's.
- **Same provider** (the field names the thread's provider): the extension fields are removed and today's native fork runs (Codex `thread/fork`; Claude does not declare `threads.fork` and answers `-32072`).
- **Different provider**: both providers must declare `threads.crossProviderFork` (else `-32072`); it means only that the provider can be a fork source (neutral `thread.turns`) and target (neutral `thread.create`) — ordinary operations, served by the companion. The companion reads the source thread's neutral history (up to 500 recent turns, cut at `lastTurnId` / `beforeTurnId`), creates a new thread on the target (`cwd`, `permissions` from the request else the source; `model` from the request else the target's default) and answers with the projected thread carrying `forkedFromId`. The source thread is unchanged.
- **Handoff**: a size-capped replay of user and agent messages, commands and file changes (default 16 000 bytes, cap 64 000; the latest request and answer and the original request are kept first; oversized items are omitted whole), ported from t3code `handoffBudget.ts` (MIT, attribution in `agent/fork/handoff.rs`). It is stored durably (`agent_thread_forks`) and prepended as a text input to the user's first `turn/start` of the new thread (direct or queued), until a turn of that thread has started; with `codewideInitialPrompt` the first turn starts at once with the handoff and the prompt. The handoff is part of that user message in the target's history.

## Token usage and cost

- `usage.updated` is emitted with every complete model request while a turn runs, and once more when the turn ends; `last` is the latest model request (the context size the client's context fill reads, `latestRequest / modelContextWindow`), `total` the thread's cumulative usage. `TokenUsage.inputTokens` counts every prompt token including cache reads (`cachedInputTokens`) and cache writes (`cacheWriteInputTokens`, added within v1). The optional `cost` (`ProviderCost {basis: list | managed, model, turnUsd, threadUsd | null}`) is a provider's own estimate, sent only when it knows the price table; `threadUsd` is `null` once any turn's cost was unknown. The optional `model` (added within v1) names the model that served `last`; the companion prices that request with it.
- A finished turn read back (`thread.turns`, `nativeSession.read`) carries the optional `AgentTurn.usage` (`TurnUsageRecord {last, turn, total, contextWindow, cost?}`) the provider reported for it; reads never emit `usage.updated`. The wire projector turns it into the same `codewide.usage` turn metadata a Codex history read carries (`TurnUsageProjection::from_record`).
- Claude: the host measures each turn as the difference of the SDK's cumulative per-model `modelUsage` totals (main loop, Task subagents, sidechains and compaction; `result.usage` is main-loop only) against the session's persisted checkpoints, including results that do not end the turn (steer aborts, task notifications); `reasoningOutputTokens` are `thinkingTokens`; costs are the `costUSD` differences of models whose `costBasis` is not `unknown`. Restart, zeroed-result and unknown-baseline rules are owned by `host/src/mapping/usage.ts`.
- Prices come with the model list: `catalog.models` carries optional `prices` (model id → `ModelPriceEntry {pricingVersion, rates, longContext?}`, USD per million tokens for input, cache reads, cache writes and output; `longContext` is a second rate card above an input size), covering every id a thread setting or a request may name, catalog aliases included. Each provider's table is the shared `CatalogPricing` (`agent_core::usage`), so every provider is priced by the same arithmetic: Codex publishes its `OpenAI` API rates, the Claude host its Anthropic API rates (`host/src/catalog/prices.ts`); the Claude adapter refreshes its table from every catalog read and before the first turn.
- Claude live usage: the host reports each complete top-level request (the next request, a tool result or a compaction completes it; one request may arrive as several assistant messages with the same id) with its model and the thread totals including it, and the context window the SDK last reported for the thread, else the model's known window (`host/src/catalog/contextWindows.ts`). The companion prices these requests from the catalog rates; the turn's final `usage.updated` carries the SDK's measured totals and its own cost, which replaces the estimate.
- Pricing in the companion: a thread is priced only by its own provider's table (the provider recorded per thread from its event stream); a provider-reported cost becomes a `CostProjection` with `basis: "providerReported"` (total only, `pricingVersion` = the provider's price table) and is journaled as a pricing input (`codewideProviderCost` on the client-wire `thread/tokenUsage/updated`, `ReplayPricing.providerCost`), never as a derived price. A Codex-only host's wire is unchanged.

## Delivery, steer and interrupt

- Neutral `turn.start` never steers implicitly. A provider whose thread is active and declares `turns.startWhileActive: busy` returns `busy {activeTurnId}`; the companion puts that outbox command back in the queued state ("deliver after idle") and redelivers it once on that thread's `turn.completed`. The client sees an ordinary queued item through `companion/queue/changed`.
- `nativeJoin` (Codex) keeps today's App Server behavior: the adapter reports `started` with the joined turn id, so Codex wire behavior is unchanged.
- Steer is only an explicit `turn.steer {expectedTurnId}`; a mismatch returns `-32600 "expected turn is not active"`.
- `turn.interrupt` answers `{}` within 1 s when a turn is active, already interrupted, completed or the thread is idle; it errors only for a foreign `turnId` during an active turn or an unknown thread. Open requests resolve with `request.resolved` before `turn.completed`. Repeats never hang.

## Error codes

- `-32070 "<Provider> provider is disabled on this host"` — terminal (`Rejected`, then `Failed`).
- `-32072 "<capability> is not supported by this thread's agent"`, `data {capability, provider}`.
- `-32020 "Thread binding is unavailable"` — the binding store could not be read or written while resolving a thread-scoped call (logged at `warn` with `err`).
- Claude agent host not live → transport `UpstreamError::Reconnecting` (outbox retries); a direct RPC gets the existing `-32003`.
- `-32600 "native session not found: <id>"` — `nativeSession.read` of a session the provider's store does not have.
- `-32601` — `nativeSession.list` / `nativeSession.read` on a provider without a native session store.
- `-32071` is not used: there is no session cap.

## Compatibility surfaces

| Surface | Decision | Owner | Removal condition | Negative check |
|---|---|---|---|---|
| `codex.native` — Codex notifications and request params without a neutral or capability mapping pass through unchanged as `capability.event` or `providerOptions["codex.native"]` | `keep_temporarily` | backend | every Codex method the client uses has a neutral or capability mapping and the client speaks the neutral protocol | no other provider emits it; the projector drops `providerOptions` for capabilities the target provider lacks (logged at `debug`) |
| ~~Codex storage modules stay in place~~ — **done**: `history_service`, `history`, `rollout*`, `catalog*`, `resources`, `message_search`, `account_pool`, `rollout_store` and the OpenAI price table (`pricing.rs`) live in `crates/agent-provider-codex/src/` | `removed` | backend | — | SyncHub reaches history, message search and resources only through the `NativeSurface` storage traits (`crates/agent-core/src/provider/native_storage.rs`), implemented by `CodexStorage` (`crates/agent-provider-codex/src/storage.rs`). Usage is split: provider-neutral accounting and `prepare_replay_payload` in `crates/agent-core/src/usage.rs`; `LiveUsageProjector` stays in `crates/companion-core/src/usage.rs`; SyncHub prices a thread only through its own provider's `AgentProvider::usage_pricing` table (`UsagePricing::for_provider`), so no price table lives outside its provider crate and no model is priced by another provider's table |
| `wire-request-ids-v0` — primary-provider runtime request ids are emitted unchanged (the client persists them); other providers' ids are emitted as `"cw-<provider>:" + JSON(nativeId)`; a primary-provider string id starting with `cw-` is rejected and logged | `keep_temporarily` | backend | the client moves to the neutral protocol | non-primary ids always carry the prefix; a reconnect of one provider resolves only that provider's user-interaction requests |

## Claude provider

The Claude provider is one crate, `crates/agent-provider-claude`: the Rust adapter (`src/`) and the Claude agent host (`host/`, package `@codewide/claude-agent-host`), a Node process that exists only as the adapter's child (formerly `apps/claude-sidecar`).

- **Process model.** The Claude adapter supervises one Claude agent host child and speaks `codewide-agent` v1 JSON-RPC over stdio. The host opens one Agent SDK query per live session against the user's own `claude` CLI.
- **Session lifecycle.** `Shell` (hidden from the non-archived list until the first user message) → `Active` ↔ `Idle` → `Released` (idle release) → resumed on the next turn; a lost session is recovered with a new session id and a bounded transcript prefix (up to 16 KiB under `[Historical conversation from this thread]`, built from whatever history Claude's store still has for the thread); a second loss in the same turn fails it.
- **Idle release.** After 30 min without activity (configurable 5–240 min); never while a turn is active or a request is pending; background tasks defer release up to 4 h.
- **No session cap.** One idle `claude` process costs about 125 MB PSS (research probe P2), and idle release bounds the steady state. Without a cap, a host-killed `claude` process fails only its own active turn ("Claude process exited unexpectedly"); its open requests resolve, the session becomes `Released` and the next turn resumes it. The host logs its live session count at `info` on every open and release. The companion memory watch reads only the companion main PID, so host children do not trigger its alerts.
- **Permission profiles.** `:read-only` restricts built-in tools to Read/Glob/Grep/LS, disables settings sources and MCP, and denies everything else in `canUseTool`; `:workspace` accepts edits with user/project/local settings and asks for the rest; only `:full-access`/`:danger-full-access` bypasses permissions; an unknown profile returns `-32602 "Unsupported permission profile for Claude: <id>"`. A profile change between `:workspace`, `:full-access` and `:danger-full-access` takes effect at once, also inside a running turn (`setPermissionMode` on the live query; a query opened without `allowDangerouslySkipPermissions` keeps its mode and `canUseTool` allows every tool while the thread's profile is full access); a change to or from `:read-only`, and model or effort changes, apply at the next turn boundary. The thread reports the chosen settings (`pendingSettings ?? settings`) in `thread.updated` as soon as they change. A client-wire `turn/start` carrying `model`, `effort` or `permissions` (a new chat sends them only there) becomes a neutral `thread.update` settings change before `turn.start`.
- **Approval decisions.** `accept` → allow; `acceptForSession` → session-scoped permissions only (never a settings file); `decline` → deny; `cancel` → deny with interrupt. `canUseTool` never returns `null`; a decline or response error never becomes allow.
- **Credentials.** No CodeWide component reads, stores, forwards or logs Claude credentials, tokens or `ANTHROPIC_*` values. Auth state comes only from the SDK initialization result (the plan type and the account's email or organization, never a token or key source), forwarded by `initialize` and `account.updated`; subscription limits come only from SDK rate-limit frames and its usage read. The Rust watcher reads only directory entries and size/mtime under `$CLAUDE_CONFIG_DIR/projects` (or `~/.claude/projects`); session records are read only by the host through the SDK. Claude has no price table; its costs are the SDK's own estimates (see [Token usage and cost](#token-usage-and-cost)).
- **Logs.** Full errors in `err`; opaque ids allowed; prompts, outputs, tool inputs and env values never logged.

### History and thread list from Claude's session store

The Claude provider is symmetric with Codex: Codex's adapter crate owns rollout storage, a rollout parser and a native index; Claude's adapter crate (`crates/agent-provider-claude`, Rust) owns its native index in the companion's `state.redb` and a watcher on Claude's session files, and the Claude agent host is its parser — it reads Claude's native sessions only through the official SDK session API and maps them to neutral items. The host keeps no conversation copy and no index or cache of history.

#### Native session operations (additive v1)

Two optional operations, typed in `packages/agent-protocol` (`OperationMap`, `NativeSession`, `NativeSubagent`; fixture `fixtures/v1/native-sessions.json`). A provider without a native store answers `-32601`; no capability is added, because only the provider's own adapter crate calls them.

- `nativeSession.list {dir: string|null, cursor: string|null, limit}` → `{sessions: NativeSession[], nextCursor}` — every session of one project directory (with its git worktrees) or of all projects, programmatic and interactive, newest first, at most 500 per page. `NativeSession {sessionId, appThreadId, cwd, title, summary, firstPrompt, createdAtMs, lastModifiedMs, fileSize, interactive}`: `appThreadId` is the session id, or the CodeWide thread a replacement session continues; `lastModifiedMs` and `fileSize` let the index detect a change cheaply; `interactive` marks sessions a person started (terminal, IDE). The cursor (`v1:<offset>`) is opaque; a store change between pages may shift entries, which a re-index tolerates.
- `nativeSession.read {sessionId}` → `{session, turns: AgentTurn[], subagents: NativeSubagent[]}` — one session as neutral turns, rebuilt as below, plus each sub-agent transcript (`getSubagentMessages`) as `{agentId, parentAgentId, parentToolUseId, turns}`, sorted by `agentId`; `parentToolUseId` links it to the spawning tool item. Ids depend only on the stored messages and the host's turn index: turn id = the host's turn id or the uuid of the turn's first stored message; items `{turnId}:user:{n}`, `{message.id}:{block}`, `tool_use.id`, `{tool_use.id}:image`, the compact-boundary uuid. Reading unchanged input twice returns equal results, so re-indexing is idempotent. A turn still running in the session is returned as its live snapshot (`inProgress`); after `turn.completed` the companion re-reads and re-indexes. Unknown session: `-32600 "native session not found: <id>"`.
- `NativeSession.codewide` (optional; omitted for a session CodeWide never touched) carries every `thread.list` row field Claude's store cannot hold: `{createdAt, cwd (the CodeWide thread's working directory, where its turns run), origin: "interactive" | "external", presence: {type: "listed", archived} | {type: "deleted", deletedAt}, recencyAt: number | null, settings: ThreadSettings (effective: pending settings when set), title: {type: "none"} | {type: "pending", name} | {type: "cleared", hiddenTitle}, updatedAt}` (unix seconds). The row name is the latest session title of the thread, replaced by `title.name` when `pending`, and `null` when `cleared` and the store title equals `hiddenTitle`. Tombstoned threads whose session still exists are listed with `presence.type: "deleted"`, never silently dropped. Every session of a chain carries the same object.
- Each session's `turns` hold only that session's share of its thread: a replacement session after a lost session starts with the resent prompt (history prefix removed, the original turn id and `clientMessageId`) and never repeats earlier turns. If the old session still exists in the store, the interrupted turn appears in both sessions under the same turn id; the later session's share is the continuation.
- Every turn and item the host emits (live events, `thread.turns`, `nativeSession.read`) carries `provenance {provider: "claude", nativeThreadId: <appThreadId>}` (phase 1: the Claude thread is its only native thread).
- Live turns keep streaming as events; `thread.list`, `thread.read` and `thread.turns` keep working from Claude's store until the companion serves them from its index.

- `thread.list`, `thread.read`, `thread.turns` and `thread.owns` read Claude's own session store through the SDK session API: `listSessions` (all sessions, and `includeProgrammatic: false` for sessions a person started), `getSessionInfo` and `getSessionMessages`. `thread.update` name and delete use `renameSession` and `deleteSession`.
- Listed threads are CodeWide's own threads plus every session a person started outside CodeWide (for example, `claude` in a terminal or an IDE), with the session id as thread id, `origin: external` and default settings (`model: default`, `:read-only`) until changed. Other SDK-started sessions are not listed unless the host owns them. `thread.list` semantics are unchanged: params, the `v1:<sortKey>:<direction>:<valueSec>:<id>` cursor, the sort keys (`recencyAt` falls back to `updatedAt`), windows, search over name else first prompt, and shells hidden from the non-archived list. Every listing rescans Claude's store; the host keeps no index or cache of history. On the client wire every non-native row carries that order key as `recencyAt` (its `updatedAt` when the thread has no recency of its own), never `null`: a client that persists `recencyAt` as a sort column would otherwise order such threads after all others.
- Name: Claude's session title (`/rename`, `renameSession` or Claude's generated title). A name given before Claude created the session is kept by the host and applied with `renameSession` once the session exists; clearing a name (Claude cannot) hides the current title in the host. Repeats emit `thread.updated` only on a real change.
- Delete writes a host tombstone, then deletes every session of the thread's chain with `deleteSession`; a session Claude no longer has counts as deleted, a failed removal is logged at `error` and retried by a repeated delete, and repeats always answer `{thread: null}`.
- The host keeps only metadata Claude's store cannot hold (`<journalDirectory>/threads/<id>/state.json`, version 2): the session chain, settings and pending settings, the archive flag, the tombstone, a title override, cumulative usage and a turn index (turn id, origin, outcome and error, prompt uuids with their role and `clientMessageId`). `active-turn.json` holds the in-flight turn's snapshot until it ends, so a host restart finalizes it as interrupted. No conversation content is stored. A v1 journal of the former sidecar is converted on first start (its copied turns are left on disk unused and can be deleted).
- History is rebuilt from the stored messages of the session chain and replayed through the live `TurnBuilder`, so turns and items have the live ids, types, ordering and final-answer rule. A user turn's id is the uuid of its first prompt offer, which Claude persists. Turn boundaries are derived: a prompt starts a user turn unless the index knows it as a steer or a resent prompt, or Claude queued it (`isQueuedCommand`) into a running turn; a task-notification or peer message starts a provider turn unless Claude queued it into a running turn; `[Request interrupted by user…]` ends a turn as interrupted; the first persisted message of every host-driven turn starts that turn. The active turn is served from the live snapshot.
- Person vs. harness messages: interactive Claude Code stamps a person's prompts `origin: {kind: "human"}` (SDK-driven sessions store none); they are `userMessage` items with their text and image blocks. Messages with another `origin.kind` (task notifications, peer messages) are wakes and never `userMessage` items. Injected meta messages (`is_meta`: reminders, skill bodies) and command/markup echoes (`<command-name>`, `<local-command-stdout>`, `<system-reminder>`…) are hidden, not rendered as notices.
- Sub-agents: an `Agent` (formerly `Task`) call is a neutral `subagent` item (added within v1: `description`, `prompt`, `agentType`, `model`, `background`, `result`, `status: running | completed | failed | stopped`, `agentThreadId`), projected as Codex `collabAgentToolCall {tool: spawnAgent}` whose status stays `inProgress` while the agent runs. Its child thread id is `<app thread id>:agent:<agent id>`, from the spawning result (`tool_use_result.agentId` live, the `agentId:` line in both) or `task_started`. Live, a `task_notification` frame finishes the item of the running turn; history applies every later `<task-notification>` of the same conversation level, so a background agent finishing after its turn shows its final status after the next re-index. `nativeSession.read` keeps the last turn of a sub-agent its spawning item still reports `running` in progress.
- Child threads: the adapter indexes each sub-agent's turns (`claude_subagent_turns`) and publishes a companion thread-index row under its parent (nickname = description, role = agent type); `companion/threadSubagents/read` of a thread without the `codex.native` surface reads that tree. `thread.read` / `thread.turns` / `thread.owns` of a child id are answered from the index (read-only; the thread is `active` while the agent runs); the host has no thread for them.
- Lost in history compared with live: reasoning text (Claude stores only thinking signatures; reasoning items keep their ids with empty summaries), Bash stdout/stderr split (the tool result text is used), applied patches (file diffs are rebuilt from Edit/MultiEdit/Write input; a `Write` over an existing file shows as `add`), tool durations other than tool_use → tool_result timestamps, MCP server names when they contain `__` (the init frame is not stored), and — for sessions the host did not drive — `clientMessageId` echoes, failed outcomes and steer grouping. If Claude's store loses a session, its history is gone too, and a replacement session gets only the prefix the store still allows.

### Discovery of sessions started outside CodeWide

- Claude declares `threads.externalDiscovery` (adapter baseline and host). A terminal-started session becomes a thread when it appears in a merged `thread/list` page or a `thread.updated` event (observation), through the one-time backfill over Claude's `thread.list`, or on a miss: discovery asks Codex then Claude via `thread.owns`; Claude answers from its native index first, then from the host, which owns any session in Claude's store that is not another thread's continuation.

### Claude native index

- `thread.list`, `thread.turns`, message search and thread resources of Claude threads are served from the companion's Claude native index; the host answers until the index is fresh. The provider-neutral thread resource model, projection and service live in the shared crate `crates/agent-resources`; Codex keeps its rollout reading and its own store.
- Freshness: the index serves `thread.list` only after a listing pass matched the host, while no turn runs and no re-read is pending; a `thread.updated` the index would list differently triggers a collapsed re-pass. Deleted threads are dropped from list, search and `thread.owns`. Turns are de-duplicated by turn id across a thread's sessions (the later session wins).
- Known gaps: a CodeWide thread with no session file yet, and a first prompt Claude has not written yet, are not in the index list (the host answers during running turns anyway). Merged search treats a failing provider index as a failed source and errors only when every source fails.

- Symmetric with Codex's rollout index: the Claude adapter crate derives disposable tables inside the companion's index database — `claude_sessions` (session id → indexed session), `claude_session_turns` (session id + ordinal → one neutral turn) and `claude_thread_sessions` (app thread id + session id) — versioned by `claude_index_logic_version` (a change drops and rebuilds them).
- Watcher: filesystem events under Claude's projects directory trigger a debounced rescan, plus a periodic 30 s rescan. It compares each session's `fileSize` and `lastModifiedMs` from `nativeSession.list` (the file's byte size and floor of its mtime in ms) with the index and re-reads only changed sessions.
- Indexer: backfills every listed session with `nativeSession.read`, re-reads a session after a change or after `turn.completed` of a live turn, and removes sessions that left the store. CodeWide thread metadata from `NativeSession.codewide` is published to the companion's thread index, so the catalog and thread list are served from the index; tombstoned sessions (`presence.type: "deleted"`) are dropped there.
- Freshness rule: the index serves `thread.turns` only when the thread has no running turn and no pending re-read; otherwise the call goes to the host.
- Message search: the adapter writes indexed turns into `claude-message-search.sqlite` using the shared `crates/agent-search` schema (`documents::replace_thread`). `companion/search` routes to every provider declaring `history.messageSearch` and merges results in the shared order (newest first, then thread id, then the later position); continuations are never search results.

### Install and configuration

- Shipping: the Claude agent host is built with Bun (`bun build --compile`, `scripts/build-claude-agent-host`) into one executable without the Claude Agent SDK. The Linux companion binary carries it (Cargo feature `embedded-claude-host`, enabled by the release builds; `build.rs` compiles it, or takes `CODEWIDE_CLAUDE_HOST_BINARY` in the container bundle build) and writes it once to `<state dir>/claude-agent-host/<digest>/claude-agent-host`; the macOS app carries it as `Contents/Resources/claude-agent-host`. Nothing else is installed: no Node.js, no npm step, no separate installer. The user installs and signs in to the `claude` CLI. Codex stays required: a Claude-only host (no Codex app-server) is not supported, because Codex is the primary provider built from the `serve` flags.
- The Claude Agent SDK is not redistributed (its license grants no redistribution). On start, when Claude will run the shipped host, the companion downloads the pinned package (`agent_sdk::AGENT_SDK`, equal to `host/install/package-lock.json`, checked by a test) from the npm registry, verifies its `sha512` integrity and unpacks it to `<state dir>/claude-agent-sdk/<version>/`; the host loads it with `--agent-sdk <…/sdk.mjs>`. A version is reused, without network, only when its marker (`.codewide-integrity`, written before the directory is moved into place) names the pinned integrity; otherwise it is reinstalled. The pinned version and the most recently used other one are kept (a rollback needs no network), older ones removed. Staging directories (`.agent-sdk-*`) and the host's temporary files (`.claude-agent-host-*`) a killed start left behind are removed by a later start once older than an hour; other host digests are removed at once. A failed download is logged once at `error` and leaves Claude off until the next start. On start the companion also removes the former installer's host directories (Linux `~/.local/lib/codewide/claude-agent-host` and `…/claude-sidecar`, macOS `~/Library/Application Support/CodeWide/ClaudeAgentHost`) unless `providers.claude` still runs a host from one of them.
- Config file `<companion state dir>/agent-providers.json` (Linux `~/.local/state/codewide/companion`, macOS `~/Library/Application Support/CodeWide/Companion`): `version: 1`, `primary: "codex"`. Without a `providers.claude` entry Claude runs when the companion ships the host and finds `claude` (on the user's login-shell `PATH`, the companion's `PATH`, `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin`, `/usr/local/bin`); `"claude": false` turns it off. An entry object overrides any field, all optional: `claudeExecutable`, `hostExecutable` (another Bun-built host) or `runtimeExecutable` with `sidecarEntry` (a JavaScript runtime and the host's `dist/main.js`, for development), `agentSdk` (an `sdk.mjs` instead of the downloaded one), `journalDirectory` (default `<state dir>/claude-journal`; passed as `--journal-directory`), `idleReleaseMinutes` and `environment`.
- `environment` holds only `PATH` (absolute directories, no empty entry) and `CLAUDE_CONFIG_DIR` (absolute); any other key, including `ANTHROPIC_*`, makes the entry invalid. A service manager starts the companion with a minimal `PATH`, while Claude's Bash tool inherits the host's `PATH`; without `environment.PATH` the adapter asks the user's login shell (`$SHELL -l -c 'printenv PATH'`, bounded to 5 s) and falls back to the companion's own `PATH`. The host child gets `PATH` = the directories of a script runtime (when configured) and of `claude`, then that `PATH`, and `CLAUDE_CONFIG_DIR` when configured. The watcher observes `<CLAUDE_CONFIG_DIR>/projects` from the same entry (else the companion's `CLAUDE_CONFIG_DIR`, else `~/.claude/projects`).
- File absent, unreadable or invalid → Codex only, built from the existing host flags (an unreadable or invalid file is logged once at `error`); the registry is still built and holds one provider. An invalid `providers.claude` entry or an unknown provider id → only that provider is disabled, with one `error` log. The primary provider must serve the merged client surface (`thread/list`, `model/list`, `permissionProfile/list` pass through its `codex.native` surface): a configured `primary` that is not enabled or lacks that surface is logged at `error` and Codex leads instead.
- `registry.rs` parses the file with opaque per-provider entries; the mapping from a provider id to its adapter lives in `crates/companion-core/src/agent/providers/mod.rs` (`build_registry`), so the registry never imports an adapter.
- `crates/agent-provider-claude/host/package.json` is the single SDK version source; the install lock check (`scripts/checkInstallLock.mjs` against `host/install/`) fails the host tests on drift.
- `codewide-companion providers status [--state-dir <dir>]` (Linux) prints the providers as JSON — config state, each provider's status (`builtIn`, `ready`, `notReady` with problems, `disabled`, `off` with the reason Claude does not run, `invalid`, `unknown`), the host's effective `PATH` and the watched session store — and exits non-zero unless every configured provider is ready. It is offline: it reads the config and file metadata (and the `#!` line of each executable, resolving an `env` interpreter on the host `PATH`), starts no process and makes no model call. It installs nothing: the shipped host and the Agent SDK count only once they are in place.
- Logs: every host installs the shared filter (`companion_core::log_filter`): `warn` for all targets, `info` for the companion, `companion_core::agent`, `agent_transport` (child starts, restarts, the host's stderr records) and the provider adapters; `RUST_LOG` directives refine it per target instead of replacing it. Linux logs to the journal; macOS writes `~/Library/Logs/CodeWide/companion.log` (rotated at 8 MiB into `companion.log.1`).

#### systemd hardening (Linux, E-HARDEN)

The host, `claude` and every Bash tool command are children of `codewide-companion.service` and inherit its sandbox (Codex tools run under the separate app-server). Measured with transient units carrying the unit's hardening (systemd 255): `os.networkInterfaces()` fails with `EAFNOSUPPORT` without `AF_NETLINK`; bubblewrap (Claude's sandboxed Bash) fails with "No permissions to create new namespace" under `RestrictNamespaces=true`, and with `--unshare-net` also needs `AF_NETLINK`; `claude --version` itself runs. Because Claude runs by default, the unit itself (`apps/companion-linux/deploy/codewide-companion.service`) adds `AF_NETLINK` and allows the namespace types bubblewrap creates (`user mnt pid net ipc uts cgroup`); the former `claude-provider.conf` drop-in is gone. `ProtectSystem=full` stays: a `claude` installed under `/usr` cannot update itself while CodeWide runs it (update it from a shell). `NoNewPrivileges` and the empty capability bounding set stay.

### Pending host evidence

- **E-HARDEN** — property-level outcome recorded under [systemd hardening](#systemd-hardening-linux-e-harden) (`AF_NETLINK` and the bubblewrap namespaces relaxed in the unit). A full Claude turn with a Bash tool under the installed unit is *not yet recorded*.
- **Idle memory** — load run with 10 sessions (expected about 125 MB PSS each while idle, released after the idle timeout). Measurement: *not yet recorded*. It is not a pass threshold.
- **E-PERM-RO, E-STEER-UUID, E-INT-TOOL, E-STEER-WAKE** — SDK experiments gating the host mapping. Fallbacks that keep the contract: steer without a uuid; release the session after an interrupt that hit a running tool.

## Rollback

- Triggers: any Codex golden-replay diff or Codex regression; a Claude permission bypass; more than 5 Claude agent host restarts in 10 min.
- **Disable Claude:** remove `providers.claude` from `agent-providers.json` and restart the companion. Claude models leave the picker, calls on Claude threads return `-32070`, queued Claude commands fail once, Claude rows leave the list. Bindings and the host's thread metadata stay; nothing is deleted.
- **Revert the layer:** revert the C3 switch-over commit. The old single-upstream route returns. The binding table is ignored and needs no reverse migration.
