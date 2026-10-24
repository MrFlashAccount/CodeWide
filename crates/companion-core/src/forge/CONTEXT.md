# Forge

## Purpose and owner

`forge/` is the companion's bounded context for forge pull requests. It owns providers, account links and auth flows, PR identity, plugin selection and calls, the action-run journal, PR–thread links, agent scenarios and branch detection. It serves the `companion/forge*` and `companion/pullRequest*` RPC families through `ForgeService`. The plugin contract is [`docs/forge-plugins.md`](../../../../docs/forge-plugins.md).

Code owner: backend. This document: architect.

Deleting this module removes every PR surface; review targets that do not involve a forge stay in [`review/`](../review/CONTEXT.md).

## Module jobs

- `mod.rs` — `ForgeService`: dispatch of `companion/forge*` and `companion/pullRequest*`; claims every such method before the App Server fallback, even with every provider disabled.
- `ids.rs` — branded newtypes and their validation: `PullRequestKey` (`fpr1.<base64url>` over plugin id, host, repository, number; opaque to Android), `ForgeAccountKey` (plugin id + host + login), `HeadRevision`, `AuthFlowId`.
- `providers.rs` — the provider list: compiled-in built-ins plus external entries; durable enable flags.
- `bundled.rs` — the built-in descriptors (`bundled:github`, its default host `github.com`) and resolution of `bundled:<id>` at every spawn against the host-supplied bundled plugin directory; a missing binary is "provider unavailable", never a fallback path.
- `registry.rs` — `forge-plugins.json` v1: external plugins (`id`, absolute canonical `executable`, `args`, `priority`), atomic writes, built-in ids reserved.
- `directory.rs` — `companion/forge/accounts/read` and `companion/forge/provider/setEnabled`: provider descriptors with `defaultHost`, sanitized auth methods and derived account states; a provider that cannot start degrades only its own card.
- `accounts.rs` — account links (no tokens), account state derived from `auth.verify`, `unlink`, `forgetToken` and confirmed `logoutHost`.
- `auth.rs` — auth flows: start, one dedicated plugin process per flow, poll every 5 s, cancel, 15-minute expiry reported as `failed` with a reason, and a terminal `failed` flow kept until dismissed, restarted or 15 minutes pass; `submitToken` handled before any journaling.
- `plugin_client.rs` — spawn, `initialize`, capability check, timeouts, bounded concurrency. Uses `forge-protocol` framing; the VCS plugin client is not refactored.
- `cache.rs` — in-memory list and overview cache with freshness windows. No PR content on disk.
- `attention.rs` — hashes a provider activity witness and durably records the exact revision last displayed for each PR; list and overview reads expose only the content-free digest plus `new | seen`.
- `review_chat.rs` — durably assigns one canonical ordinary agent thread to a PR. `chat/ensure` may create and link the thread, but never enqueues a message or starts a turn.
- `reads.rs` — the legacy cross-account list, provider-aware structured search, the atomic overview, activity pages, file pages with hunk catalogs and viewed marks; one plugin process per provider batch.
- `pr_catalog.rs` — the pull request implementation of review's `DiffCatalogSource`.
- `actions.rs` — catalog validation, kind floors, the `forge_action_runs` journal.
- `action_run.rs` — `companion/pullRequest/action/run`: idempotency replay, fresh catalog at the requested head, effective confirmation, journal, then the plugin call.
- `submit.rs` — Submit review over `review::DraftStore`.
- `links.rs` — PR–thread links (`branch`, `manual`, `agent`), tombstones, local-checkout resolution.
- `detection.rs` — demand-driven branch detection: `vcs.remotes@1`, then `forge.repository.resolve`, then `forge.pullRequests.byBranch`.
- `scenarios.rs` — `fixCi`, `rebase`, `addressComments`, `reviewPr`, `message`; caller-chosen target, workspace admission, untrusted context input.
- `tools.rs` — the `codewide_link_pull_request` client tool host.
- `limits.rs` — page sizes, timeouts, concurrency, freshness windows and auth flow timing. Android renders flags and does not restate these numbers. Guide limits are owned by `review/guide`, because review must not import forge.
- `ids.rs`, `wire.rs`, `errors.rs` — branded ids; the companion → client shapes; the `-32080..-32089` error model and the plugin-code mapping.

Composition outside this folder, each with one job:

- `sync/forge_rpc.rs` — constructs the forge and review services, claims their RPC families before any App Server forwarding, and feeds thread lifecycle events to detection.
- `agent_bridge.rs` — hands turns to the existing durable outbox, creates threads with an explicit permission profile and reads a turn's final message; it never names a provider.
- `server/forge.rs` — admin routes `/v1/forge/providers` used by the Linux `forge provider` CLI.
- `store/kv.rs` — lazily created `&str → bytes` tables used by `forge_tables.rs` and `review_tables.rs`; `store/thread_cwds.rs` looks up thread `cwd`s in the companion thread index for workspace admission.
- `vcs/remotes.rs` — the optional `vcs.remotes@1` call.
- `untrusted.rs` — the single owner of fencing third-party text as data for agent prompts, shared by forge scenarios (`scenarios.rs`) and the review guide catalog (`review/guide/catalog.rs`). Rules:
  - each block's fence is a run of `~` longer than any `~` run in its body, so no body line can close it;
  - attribute values lose quotes, line breaks and control characters and are cut to 200 characters, so they cannot end the opening line or the attribute;
  - all block bodies of one section share one byte budget; a body is cut to the remaining budget, and a block with nothing left to show is dropped.

  Forge and review never hand-roll fencing; every third-party text an agent sees goes through `UntrustedText`.

Durable state lives in `store/forge_tables.rs`: `forge_accounts`, `forge_provider_settings`, `forge_pr_links`, `forge_link_tombstones`, `forge_action_runs`, `forge_pr_attention`, `forge_pr_review_threads`. Tables are additive and created lazily on first write.

## Invariants

- **No token in the companion.** A forge token is never returned by a plugin, never stored in redb, `SecureStore`, the journal or logs, and never sent to Android. The only token that crosses the companion is the `submitToken` param, passed unchanged to the plugin's `auth.start` stdin and dropped; it is excluded from the replay journal, the outbox and request logging.
- **One trigger per forge write.** Review comments and the verdict: only `companion/pullRequest/review/submit`. Catalog actions: only `companion/pullRequest/action/run` with `confirmation` at or above the effective level (`-32089` otherwise). Viewed marks: only `companion/pullRequest/viewed/set`. Attention: only `companion/pullRequest/attention/seen`, after the matching overview revision was displayed. Auth flows: only `companion/forge/auth/start` from a device-authorized session. No agent tool, scenario or refresh path constructs an action run or starts an auth flow.
- **Attention is revision-exact and content-free.** A provider witness is hashed before storage or client projection. Opening revision A never marks a later revision B as seen. Recording a marker invalidates the server list cache but does not push a list invalidation to the active client, so a row cannot move between attention groups while its detail remains open.
- **Opening chat is not sending.** `companion/pullRequest/chat/ensure` reuses the PR's live canonical thread or creates and links exactly one. It never calls the agent enqueue path; only an explicit composer submission or scenario starts a turn.
- **Search is complete or rejected.** `companion/pullRequests/search` sends the same typed query to every selected account. A provider without `forge.search@1` may receive only the exact legacy projection supported by `forge.list@1` (category, zero or one repository, open state and default sort); any richer query fails the read. The companion never drops an unsupported condition and returns a broader result set.
- **Stale head.** Every run and Submit carries `headRevision`; a moved head returns `-32082` with a refreshed catalog and writes nothing.
- **Idempotency.** A run is journaled as `started` before the plugin call. A repeated `idempotencyKey` returns the stored terminal outcome without a plugin call; a timeout or restart in `started` ends as `unknown` (`-32083 outcomeUnknown`).
- **Effective confirmation** = max(plugin `confirm`, kind floor), recomputed here and never trusted from the client.
- Account state (`connected`, `expired`, `error`) is derived and never stored; `connecting` is an auth flow.
- At most one active auth flow per provider and host.
- Forge refresh is demand-driven only: client reads (60 s freshness, coalesced per account and category), `thread/started` and `turn/completed` of a VCS workspace thread (30 s debounce per workspace), and link mutations. No poller, no PR watch.
- A `branch` link is never re-added when a tombstone for that PR and thread exists. Detached HEAD makes no link; only open PRs are linked.
- `codewide_link_pull_request` writes only companion link state for the calling thread and never writes to a forge.
- Third-party PR text reaches an agent only as a separate fenced untrusted input with its source and authors.
- `overview.localCheckout.workspace` is derived only from project roots and known thread `cwd`s, so it always passes workspace admission.

## Dependency rules (`must_not_import`, checked in review)

- `forge` may import `review`, `vcs`, `workspaces`, `store` and `forge-protocol`.
- `review` must not import `forge`; forge implements review's `DiffCatalogSource` for PR files.
- `crates/agent-*` and `crates/companion-host` must not import `forge`, `review` or `forge-protocol`.
- Forge plugin crates (`crates/forge-github`, external plugins) must not import `companion-core`; they depend only on `forge-protocol`.
- No `match`/`if` on a plugin id or forge name outside `providers.rs` and `bundled.rs`; behavior branches on capabilities and descriptor kinds.
- `vcs.rs` and `vcs/plugin.rs` change only by the optional `vcs.remotes@1` call; VCS framing and ownership paths stay unchanged.

## Logging

Allowed: opaque ids (`PullRequestKey` hash, `actionId`, `ActionRunId`, request ids). Forbidden: PR titles and bodies, comment, draft and guide text, remote URLs with credentials, tokens, one-time login codes, raw `gh` or `arc` output, `submitToken` params. Plugin errors are reduced to their typed code and reason before logging.

## Validation

`pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all --check`. Recording fixture plugins prove the write triggers, stale head, idempotency and token absence in recorded companion ↔ plugin traffic; a companion test proves that no `companion/forge*`, `companion/pullRequest*` or `companion/review*` request is forwarded to App Server.
