# Agent question cards

The first proposal in `work/question-card-design/design.md` is superseded by the compact question dock. V1 renders questions only in a single editor above the composer for both `item/tool/requestUserInput` and Astra `agentMessage` items with `delivery: "async"` and structured `questions`.

## Ownership and behavior

- `features/requests/questions` validates question DTOs and owns the editor resource. Suggestions, descriptions, custom text, page navigation and explicit skip share one retained session. The main composer draft is independent.
- Nonsecret drafts use the local UI cache through `questionDraftStorage`. Secret draft values remain in editor memory and are excluded from stored drafts and summaries; submission uses the existing native response transport.
- Old history windows cannot establish a current async question: the dock requires the latest history range or the matching active turn.
- The dock is outside the virtualized timeline, follows the existing keyboard-sticky composer and caps its scrollable height at 40% of the window. It does not scroll to historical messages or register question geometry. Normal timeline behavior remains independent.
- Async answers use the ordinary durable text-command authority with bounded Codex question framing. An active turn receives a steer; an idle conversation receives a start. A command id derived from thread/item identity is reused for retries and across CodeWide devices.
- Native admission means queued, not delivered. A matching authoritative user-message `clientId` confirms delivery. Accepted answers retire the dock; the ordinary user message is the visible answer. A later accepted user message or a newer turn retires the old input opportunity without claiming delivery. Any terminal turn status or normal final answer retires all unanswered questions immediately, without submitting a default answer. Late item replay cannot restore attention for the closed turn.
- RPC answers preserve the original request id and question-id answer map. RPC identity includes its lifecycle creation time so reused server request numbers cannot restore an earlier form. Rollout evidence matched by `itemId`/`call_id` retires the live form even if pending-request removal arrives later. No historical question card is rendered inside the agent bubble.
- Summary history retains async questions separately from the final agent response. This metadata supports lifecycle reconciliation only; neither historical questions nor answer-status summaries are added to the agent bubble. Async replies remain ordinary user messages. Started/completed replay deduplicates the question by item id, and cached summary projection version 6 rebuilds older projections.

The card uses compact numbered options, a neutral selected row, an always-visible custom response and small Skip/Send actions. Selection never submits by itself. Skip failures preserve the draft and expose a retryable error.

## Deliberate limits

RPC history comes from paired `response_item/function_call` (`request_user_input`) and `function_call_output` records in the existing rollout summary owner. `codewide.questions` carries validated question identity, choices and either recorded answers or an unconfirmed outcome. The existing rebuildable summary checkpoint caches this projection; there is no independent question archive or receipt database in Companion. Projection version 6 rebuilds old checkpoints.

A recorded nonempty answer confirms that question's result, including replies sent from another client. Empty, malformed, unrelated, cancelled or absent results never imply success. Partial answers preserve their question IDs and leave omitted questions explicitly unanswered. Secret values are removed before checkpoint serialization and client projection; the client adapter redacts them defensively too. Historical metadata does not mount editor sessions.

The native pending-request projection still does not expose closure reasons. A closed RPC may disappear until the corresponding rollout history arrives; a missing result remains unconfirmed, not a guessed cancellation or delivery. The native outbox's pending-set reconciliation is not used as historical delivery evidence. Active synchronization adds only matching rollout question evidence to the App Server checkpoint: its lifecycle and items remain App Server-owned. Full App Server item refreshes preserve the existing question metadata. Rollout-unavailable threads cannot reconstruct this history.

Replies from clients that do not use CodeWide's question command identity cannot be correlated reliably from text alone. They are not guessed to be answers. Receipt detection covers loaded authoritative history; confirmed local outcomes persist across editor unmount and reconnect.

## Attention and compiler boundary

The thread list displays a raised-hand icon in the unread slot for pending user RPCs, authoritative waiting-on-input/approval flags, and async question opportunities observed in the existing summary projection. Reading a thread does not resolve attention or erase unread state underneath the hand. New user input, a newer turn, a normal final answer or any terminal turn status retires the async marker. The close button and Skip dismiss the exact async question through the existing durable summary store; only turn/item identities are retained, and unrelated approvals remain visible. A skipped blocking RPC receives an empty answer map. Question text is not copied into the catalog. An empty catalog shell with a changed update timestamp cannot prove an old async marker is current and clears it; journal or detailed history restores evidence. A catalog shell alone cannot discover historical async questions that the device has never observed.

Native outbox admission retires async attention by the existing thread/item-derived answer command identity. The existing summary database publishes one qualified row update, preserves unread state and unrelated rows, and deduplicates further delivery progress without catalog refetch or view reload. Failed delivery restores the exact question; retries hide it again. The content-free submitted identities survive snapshot replay and restart, with startup reconciliation using the existing native outbox read. A resolving input RPC also stops requesting attention immediately, including a stale waiting-on-input flag; independent pending questions and approvals remain visible.

Application Babel and all three render-test configurations share React Compiler configuration. Application sources are compiled; test probes and third-party mocks are outside that source boundary. A form reads an explicit render snapshot of observable fields, rather than passing Legend's mutable root object through compiler-memoized children. Each keystroke and selection publishes immediately before asynchronous persistence.

## Validation

The focused render tests cover page and custom-draft preservation, explicit submission, duplicate-send admission, retry, masked-value persistence, canonical RPC responses, Astra steering, authoritative receipt correlation, turn completion and the single docked editor. Compiler-enabled tests cover sequential typing, choice changes, and independent timeline keyboard behavior. Companion replay tests cover an async question surviving a persisted summary checkpoint and a later final answer, and RPC question/answer pairing across checkpoint reopen, repeated replay, partial results, cancellation, malformed output and secret redaction. UI tests cover dock retirement from rollout metadata, including another client’s answer, without rendering a historical question or answer summary.

Physical-device keyboard geometry, accessibility focus, reconnect/offline delivery and two-device interaction still require device validation. No APK/OTA/Companion release is part of this change.
