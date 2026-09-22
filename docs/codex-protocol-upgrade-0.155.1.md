# Codex 0.155.1 and agent question cards

Verified on 2026-09-21. Protocol migration is implemented; the question-card UX below is a proposal.

## Installed and generated versions

- Codex CLI: upgraded from 0.154.0 to stable 0.155.1 with `codex update`.
- Local ignored upstream checkout `openai-codex`: clean checkout of `rust-v0.155.1` (`be2951e`). It is a research reference, not a Companion build dependency.
- Project TypeScript and JSON Schema snapshots: regenerated from that CLI with experimental fields enabled, replacing 0.147.0 with 0.155.1. Consumers and fixtures use the new versioned exports.
- `pnpm protocol:generate` checks the installed CLI against `CODEX_PROTOCOL_VERSION` before generating anything. It can no longer silently put a newer schema in an older version directory.
- Updating the installed CLI does not replace a running App Server. Check `codex app-server daemon version` separately. The explicit daemon update command may interrupt active work.

The protocol's upstream `v2` namespace is unrelated to the retired CodeWide V2 frontend or transport.

## Compatibility changes

The new agent-message fields are `delivery` and `questions`. New thread metadata includes environments, project assignment, model, reasoning effort, originator and the saved Daybreak setting. Reconstructed subagent summaries use null for metadata the local index does not supply.

Sparse rate-limit updates retain the prior account identity, ordinary-usage permission, upsell metadata and normal-model alias. An unavailable permission remains unknown, and lower usage percentages do not imply permission to resume usage.

An asynchronous question uses `phase: final_answer` even while its turn continues. Item reconciliation now keeps these messages distinct from the final result and from other questions, matching them by item identity. Replaying the same item remains idempotent. This change prevents the old final-answer fallback from merging independent interactions.

## Two question contracts

| Input | Response route | Lifecycle |
| --- | --- | --- |
| `item/tool/requestUserInput` server request | JSON-RPC response to the original request ID, with answers keyed by question ID | App Server owns the pending request. Honor `isBlocking`; missing legacy values default to true upstream. Observe `serverRequest/resolved`. |
| `agentMessage` with `delivery: async` and structured `questions` | A user message containing question context and the selected or written answer, through the existing turn submission/steering path | The tool returns immediately. Independent agent work can continue. This is not a pending RPC request and has no matching `serverRequest/resolved` event. |

The async question shape is `{ title, options: string[] | null }`. Suggested choices are single-select; custom text is always available. Preselection is not submission or user authorization.

In the upstream TUI, questions have separate drafts and navigation, and handled message IDs prevent replay from reopening them. These are CLI implementation observations, not evidence of the exact ChatGPT mobile or desktop layout.

## Current CodeWide gap

`features/requests` already renders the first pending server request, option buttons, a text input and a Submit action. It only consumes the RPC path. It does not render async message questions. The existing choices scroll horizontally and omit option descriptions; answers live in the mounted prompt.

The new schemas make async fields available, but do not implement the cards. Before adding the UI, verify preservation through live events, bounded summaries, full-history hydration and restart. Companion's summary builder reconstructs agent messages from selected fields and does not currently project async question metadata. A summary cannot be treated as the authoritative set of unanswered questions.

## Options and recommendation

| Lane | Candidate | Verdict |
| --- | --- | --- |
| Incremental | Improve only the existing approval/input card | FAIL for the Astra feature: async questions do not enter that queue. Useful only for the older RPC presentation. |
| Structural | One question-card presentation with separate RPC and async-message adapters, preserving existing transport and delivery ownership | PASS as the implementation direction. It covers both actual wire contracts without inventing a second agent runtime. |
| Radical | Move every question and answer into a new Companion-owned durable interaction service | CONDITIONAL. Could unify cross-device completion and recovery, but duplicates upstream lifecycle and introduces persistence and migration costs. First test two-device answer/replay behavior with the existing message outbox; adopt only if it cannot satisfy the required semantics. Keep the experiment behind an adapter so it is reversible. |

Recommended phone interaction: a compact question card in the conversation, vertically stacked choices with full labels and descriptions where supplied, an explicit custom-answer field, and an explicit Send action. Several questions use a counter and navigation with independent drafts. Keep the main composer draft intact. Distinguish a blocking question from one asked while the agent continues; the client must not fabricate a server pause.

For a wider desktop surface, use the same interaction and state model with more visible context. This is a CodeWide proposal. Official Remote documentation confirms answering questions from the phone, but the exact current ChatGPT mobile and desktop card layouts were not directly observed in this environment.

Required acceptance scenarios before shipping cards:

- RPC answer resolves the original request; async answer arrives as contextual user input during active work or starts the next turn when idle.
- Selection alone never sends an answer. Custom text and the main composer draft survive switching questions and conversations.
- Failed delivery remains actionable; acknowledgement, retry and double taps do not duplicate an answer.
- Reconnect, replay and history hydration neither lose unanswered questions nor reopen locally handled questions.
- Answering on another device is reconciled from authoritative history rather than inferred from turn completion or an unrelated user message.
- Question events do not count as task completion merely because their phase is `final_answer`.
- Long choices remain readable and keyboard/screen-reader access works on the phone.

## Validation

- `pnpm protocol:generate`: passed; a mismatched CLI is rejected before generation.
- `pnpm typecheck`: passed for all packages and Android native/web/compatibility targets.
- `pnpm validate:android:v1`: passed, including 362 render tests, hygiene, dead-code and dependency checks.
- `pnpm --filter @codewide/android compile:android`: passed.
- `pnpm test:companion`: 444 passed, 2 ignored.
- Cargo Clippy and format checks: passed.
- `pnpm test`: 1846 passed, 1 failed in the existing `preserves changes integration contracts` source test. It expects a `trigger="long-press"` attribute in menu owners untouched by this migration. No suppression or unrelated UI change was made.
- Focused async reconciliation and rate-limit tests: 19 passed.
- Physical-device question-card interaction is not implemented or verified by this migration.

## Sources

- [Official release notes](https://learn.chatgpt.com/docs/changelog), stable 0.155.1 published 2026-09-18.
- [Official Remote documentation](https://learn.chatgpt.com/docs/remote-connections).
- [Upstream async handler at 0.155.1](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/core/src/tools/handlers/request_user_input_async.rs).
- [Upstream question UI state at 0.155.1](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/tui/src/bottom_pane/async_questions/state.rs).
- [Upstream App Server item contracts at 0.155.1](https://github.com/openai/codex/blob/rust-v0.155.1/codex-rs/app-server-protocol/src/protocol/v2/item.rs).
