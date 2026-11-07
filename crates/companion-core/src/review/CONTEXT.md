# Review

## Purpose and owner

`review/` is the companion's bounded context for review targets independent of forges: diff-source identity, hunk ids and fingerprints, draft comments, agent-written review guides and companion-local viewed marks. It serves the `companion/review*` RPC family through `ReviewService`. Session and VCS reviews use it without any forge; the forge context depends on it for PR reviews ([`forge/`](../forge/CONTEXT.md)).

Code owner: backend. This document: architect.

## Module jobs

- `mod.rs` — `ReviewService`: dispatch of `companion/review*`; claims every such method before the App Server fallback.
- `source.rs` — `DiffSource` (`session`, `vcs`, `pullRequest`), `DiffSourceRevision` and the `DiffCatalogSource` trait. The trait has three real implementations: forge PR files (`forge/pr_catalog.rs`), VCS diffs and session/turn resources (`catalogs.rs`).
- `catalogs.rs` — the VCS (provider snapshot id as revision) and session/turn (thread change resources; a turn resource uses its turn id) catalog sources.
- `hunks.rs` — `HunkId` (`<repo-relative path>#h<1-based ordinal>`, scoped to one revision), `HunkFingerprint` (blake3 hex of the normalized `+` and `−` lines without line numbers or context) and the alias catalog `h1..hN` with its excerpt budget.
- `drafts.rs` — `DraftStore` and the independent agent and PR axis transitions.
- `guide/` — guide request and re-match (`mod.rs`), the alias catalog, excerpt budget and author prompt (`catalog.rs`), and extraction and validation of the single fenced `codewide-guide` JSON block (`parse.rs`). The guide limits live here.
- `viewed.rs` — companion-local viewed marks, used only when the provider lacks `forge.viewed@1`.

Durable state lives in `store/review_tables.rs`: `review_drafts`, `review_guides`, `review_guide_progress`, `review_viewed_local`. Tables are additive and created lazily on first write.

## Invariants

- `DiffSource` is a review target, not a change source. A PR never joins `ThreadChangeScope`, which stays the six-value union.
- A draft's destination decides which axes exist: session and VCS drafts are `agent` only; PR drafts are `agent`, `pr` or `both`. A `pr` or `both` draft on a non-PR source is rejected with `-32602`. A comment on a local VCS `branch` diff cannot target a PR.
- Agent axis: `pending → sent | failed`, `failed → pending`. PR axis: `pending → submitting → published | failed | outdated`, `failed → submitting`, `pending → outdated` on a new head when the anchor fingerprint is gone, `outdated → pending` on re-anchor. `sent` and `published` are terminal; a published draft is read-only. A restart during `submitting` reopens as `failed` with `outcomeUnknown`.
- Draft writes carry `expectedVersion`; a mismatch returns `-32088` with the current draft. An exact replay of the immediately acknowledged create or edit returns that same draft, so a lost transport acknowledgement is idempotent. A `draft/put` whose hunk anchor names a revision that is no longer the source's current one returns `-32088 conflict` with `current: { revision }`.
- **Deferred:** companion-owned drafts for session and VCS sources. Until that follow-up lands, session and VCS line comments keep the existing composer review delivery on Android and are not stored here. When it lands, they become `sent` only on the composer's identity-checked acknowledgement (`companion/review/draft/agentDelivered`).
- Agent remarks from a guided walk are drafts with `author.kind = "agent"` and destination `agent`; only a user edit changes the destination. They come from optional `remarks` on guide stops validated with the guide; at most 200 are kept per guide and later ones are dropped. Until session and VCS drafts land, remarks become drafts only for `pullRequest` sources; a guide over a session or VCS source creates none. No review path writes to a forge: Submit is owned by `forge/submit.rs`.
- Guide authoring uses the author thread's final agent message, not a client tool. The author is chosen by the caller and only validated here: an existing thread, or `newThread` (always `:read-only`) whose workspace passes the admission rule in `workspaces.rs`, or `null` (the companion home).
- A guide is untrusted model output. Unknown or duplicate aliases, an empty guide, missing JSON or a guide over the caps returns `-32085` and keeps the previous guide; a catalog above budget returns `-32086` before any turn. Omitted hunks are appended to `support`.
- Re-match is exact: a stop keeps `accepted` or `commented` on a new revision only if the multiset of its hunk fingerprints exists unchanged; otherwise it becomes `changed`. Only re-match sets `changed`; `stop/set` never accepts it.
- Limits: guide catalog at most 2 000 hunks and 60 000 excerpt characters; guide at most 64 chapters, 256 stops and 4 000 characters per stop.

## Dependency rules (`must_not_import`, checked in review)

- `review` must not import `forge` or `forge-protocol`. Forge-specific data arrives only through a `DiffCatalogSource` implementation or a caller-supplied author; no `GuideAuthorResolver` port exists.
- `review` may import only:
  - `workspaces` (admission), `store` and `vcs`;
  - the session/turn resource owners (`agent::provider::NativeThreadResources`) for its catalog sources;
  - `agent_bridge` (turns through the durable outbox, thread creation, final-message reads);
  - `agent::permission_profiles` (the `:read-only` profile of a `newThread` author);
  - `untrusted` (fencing diff excerpts in the guide prompt).
- `review` never hand-rolls fencing of third-party text; it uses `untrusted::UntrustedText`.
- `crates/agent-*` and `crates/companion-host` must not import `review`.

## Logging

Draft bodies, guide prose and hunk excerpts are never logged; only opaque ids (`DraftId`, `GuideId`, `StopId`, request ids).

## Validation

`pnpm test:companion`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all --check`. Fixtures prove axis transitions, Submit outcomes (published, partial, failed, stale, restart during submitting), guide rejection cases, omitted hunks moved to `support`, the over-budget error and re-match by fingerprint. The existing session and VCS review tests stay green.
