# V1 pull request screen

Public surfaces: `PullRequestScreen`, `PullRequestScreenSkeleton` and `pullRequestScreenContract`. Route composition publishes the destination immediately; the screen suspends on the process-owned overview query behind its own stable skeleton, so the adjacent catalog does not disappear while the detail loads.

The screen owns: the app bar, the Overview | Changes tabs with one dock per tab, the Overview sections (status header, slotted action row, conflict and notice banners, native merge card with the auto-merge switch, checks with anchored actions, linked threads, activity, description), the Changes tab (Files | Guide over the forge diff in recorded-patch mode, viewed marks with their source, drafts with per-axis badges, the comment sheet, the review dock and Submit sheet), and agent scenarios started from catalog actions or the Overview message dock.

Pure policies: `actions/actionSlotting.ts` (phone 1 + 2, tablet 2 + 3, measured width, anchored targets, verdicts to the dock, merge kinds to the merge card) and `actions/confirmationPolicy.ts` (kind floors only raise a level). The runner (`actions/useActionRunner.ts`) confirms at the effective level, keeps one idempotency key per intent across a transport failure, and recovers by code: a moved head shows the stale banner and refreshes; a forge refusal restores the forge's state and shows its reason. The native RPC bridge carries no JSON-RPC `data`, so recovery re-reads resources instead of trusting error payloads.

State: `pullRequestScreenModel` is one Legend observable per mounted route session (tab, Files/Guide, selected file, pending runs and toggles, notice); it never copies resource data. Files, drafts and the guide are progressive resources read during render.

Every forge write has one trigger here: catalog actions through `action/run`, review comments and the verdict only through Submit review, viewed marks only through the file row toggle. Offline, writes are refused locally and nothing is queued.

Boundaries: may import `features/review` public modules (editor, comment sheet, draft card, guide panel, review target capabilities); must not import `features/pullRequests`.
