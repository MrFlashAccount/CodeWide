# V1 requests

Pending request presentation, form validation and response admission.

Public surfaces: RequestFeature (ApprovalPrompt/approvalTitle), requestResponse, ConversationRequestPrompts, QuestionFeature.

The pending request remains owned by the lower model. Approval forms retain their mounted state. Question forms use model-owned retained draft resources backed by the sanitized local question draft cache; request response errors remain visible. No request entity or protocol is duplicated.

Imports: lower data/platform/shared UI and declared peer public capabilities only. Private views, styles, policy helpers and React hooks remain local; no RemoteWorkspace or root import.

M3 source extraction is implemented. Verification: V1 native/web/compatibility typing, ESLint/dependency graph; elicitation-form; v1-request-queue-actions.render. Actual Android interaction and same-device performance remain unverified because no device is attached.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

QuestionFeature composes typed RPC adapters and async message adapters over one neutral card. It consumes conversation-scoped text delivery and canonical history receipts; it does not own a parallel transcript or outbox. QuestionDock owns one compact editor above the composer, independent of timeline geometry. Agent bubbles contain no question-history cards or answer-status summaries. New accepted user input retires preceding async questions without claiming they were answered. RPC closure uses validated rollout question/answer metadata without rendering a second transcript. Secret answers are redacted before projection. Missing RPC results and non-CodeWide async answer correlation are not inferred; see `docs/agent-question-cards.md` at the repository root for the current receipt boundary.
