# V1 accounts

TypeScript/TSX owns account login/profile interactions and usage presentation. The existing account database, V1 account endpoints and refresh deduplication remain lower-owned. M1 source migration is implemented; actual device sign-in has not been exercised here.

Public surfaces: `AccountPoolEditor` and `AccountPoolProps`, `UsageMenu`/`ContextRing`, `WorkspaceAccountUsageMenu`, and `CostBreakdownMenu`. Workspace supplies qualified account commands; no broad runtime object enters the feature. Private profile rows, login sheet, `accountLogin`, `accountUsage` and session summary compose these public surfaces.

Profile operation pending/error remains with the account editor. Login/code feedback belongs to the mounted login hook. Explicit close cancels the server login; unmount clears only the copied-code timer. A changed profile-ID snapshot hides completed login feedback without adding cancellation. Copied feedback expires after the existing 2400 ms delay. Usage reads use the same live database query, retain stale/error snapshots, and refresh on existing open intent; there is no fetch effect or duplicate cache.

Account profile rows visualize the canonical Codex allowance without deriving a second quota model: the weekly remaining percentage is the outer thin ring, the optional five-hour percentage is the inner thin ring, and the center dot carries account-status color. Rings and inline limit bars are white until remaining capacity falls below 15%, when their progress becomes warning orange. The inline disclosure owns the weekly-first limit bars and banked-reset actions. Reset times are details, not collapsed-row subtitles; unavailable five-hour limits do not reserve an inner ring.

Imports may reach existing data models, rendering-neutral UI and theme primitives. No private feature imports, V2 dependencies, lower-to-feature edges or facade import are allowed. Styles stay with their narrow common account surface owner.

Verification: `v1-account-login.render.test.tsx`, usage-menu/workspace-subscriptions render tests, account semantic tests, `usage-menu-summary.test.ts`, `v1-settings-feature-contract.test.ts`, and `pnpm validate:android:v1`.

M7 capability closure: `workspaceCapabilities.ts` exposes only this owner's qualified operations. Private `workspaceAdapter.ts` binds existing lower model/session authority through exact workspace composition; it does not own shared in-flight maps, runtime construction or global cleanup. The broad RemoteWorkspace facade is deleted.

`ContextRingView` renders the existing context percentage and SVG geometry from the menu owner; it introduces no state or platform reads.

`CostBreakdownMenu` exports the conversation-scoped `CostBreakdownMenuProvider`. ConversationLayout installs it for both main and read-only timelines. Closed rows retain only ordinary RN triggers; one lazily mounted native popup owns the selected estimate. Estimate updates reach the open body without broadcasting popup state to all rows. Source removal, dismissal and window changes retire the request; stale measurement and dismissal callbacks cannot replace a newer selection.
