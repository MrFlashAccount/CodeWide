# V1 pull request screen

Public surfaces: `PullRequestScreen`, `PullRequestScreenSkeleton` and `pullRequestScreenContract`. Route composition publishes the destination immediately; the screen suspends on the process-owned overview query behind its own stable skeleton, so the adjacent catalog does not disappear while the detail loads.

The screen owns: the app bar, the Details | Changes tabs, the Details reading surface (status, actions, description, activity and the merge/checks/linked-thread readiness rail), the Changes work surface (Files | Guide over the forge diff in recorded-patch mode, viewed marks with their source, drafts with per-axis badges, the comment sheet, the review dock and Submit sheet), and agent scenarios started from catalog actions. Opening the linked chat is navigation and must not start a scenario or enqueue input.

The linked-chat action only chooses or creates the PR-linked thread. Route composition presents that thread through the canonical `ActiveWorkspaceConversation`; the PR feature must not own or copy conversation rows, bubbles, renderers, activity, composer state or composer controls.

Pure policies: `actions/actionSlotting.ts` (phone 1 + 2, tablet 2 + 3, measured width, anchored targets, verdicts to the dock, merge kinds to the merge card) and `actions/confirmationPolicy.ts` (kind floors only raise a level). The runner (`actions/useActionRunner.ts`) confirms at the effective level, keeps one idempotency key per intent across a transport failure, and recovers by code: a moved head shows the stale banner and refreshes; a forge refusal restores the forge's state and shows its reason. The native RPC bridge carries no JSON-RPC `data`, so recovery re-reads resources instead of trusting error payloads.

State: `pullRequestScreenModel` is one Legend observable per mounted route session (tab, Files/Guide, selected file, pending runs and toggles, notice); it never copies resource data. Files, drafts and the guide are progressive resources read during render.

Every forge write has one trigger here: catalog actions through `action/run`, review comments and the verdict only through Submit review, viewed marks only through the file row toggle, and the exact attention revision through a post-commit display acknowledgement. The attention acknowledgement is replay-safe and may remain queued offline; other offline writes are refused locally and nothing else is queued.

Boundaries: may import `features/review` public modules (editor, comment sheet, draft card, guide panel, review target capabilities); must not import `features/pullRequests`.
