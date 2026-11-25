# V1 pull request screen

Public surfaces: `PullRequestScreen`, `PullRequestScreenSkeleton` and `pullRequestScreenContract`. Route composition publishes the destination immediately; the screen suspends on the process-owned overview query behind its own stable skeleton, so the adjacent catalog does not disappear while the detail loads.

The screen owns: the app bar, the Details | Changes tabs, the Details reading surface (one column at every width: the full title, a wrapping line for state, author, available update age and verdict, then the source and target branches in merge order; the forge action row when actions fit; the Agent section (`overview/AgentSection`: one row per agent scenario the catalog places in the row slot, with the plugin's label shimmering while a start is pending or the run is queued or running, a second line with `open chat`, the finished run's age, the real failure reason or the catalog's disabled reason, and a trailing Run, Retry or Run again that starts through the same scenario path; a running or settled row opens the run's chat, else the PR's review chat); the description; then the Files changed row with the file and line totals, the Review guide row, Status (`sections/StatusSection`: an Issues row with the open forge issues, a Reviews row with each reviewer's standing verdict from the loaded conversation, a Checks row listing the failing checks inline with a searchable, virtualized sheet for all jobs. Required checks appear first (running, failed, passed, then other states), other checks fold away and expand for search matches, and jobs with unknown requiredness stay visible without a checkbox. A permitted requirement checkbox and restart menu run the anchored catalog commands. Job taps open the Companion-validated viewer. The footer’s section-scoped Address all checks opens the canonical PR review chat independently of search and disclosure. Under the summary the other catalog actions anchored `checksSection` (Start CI) appear as `CatalogActionButton`s with the usual pending shimmer and run semantics; when the forge reports no checks but such an action exists, the row still shows as "Checks · No checks reported" to host it; and the merge-state row with conflict actions, the merge method and auto-merge controls; checks are summarized only once) and the Conversation or activity. Merged and closed PRs show no checks or merge rows, so a `checksSection` action goes to ⋮ there. A floating Comment pill beside the linked-chat button opens the new-comment composer sheet, and the page keeps clearance below its last entry. The PR overview’s ⋮ menu (`ui/OverflowMenu`) holds top-level Copy ID (the displayed PR number without the # prefix) and Copy title (the complete title), plus Copy link (`expo-clipboard`), Share (React Native `Share`) and "Open in <forge name>" for the overview's `webUrl` (an HTTPS page on the account host or a web host declared by its plugin, as validated by the Companion; the account host stands in for the name until the accounts snapshot loads; a failed copy or share shows its real error), then Submit review on Details when no verdict button is shown, then every overflowed catalog action in plugin order, `close` (Close, Arcanum's Discard), `merge` and destructive ones marked destructive). Each menu item has a leading icon. The screen also owns the Changes work surface (Files | Guide over the forge diff; the selected file opens immediately on its recorded patch. Expand file beside its ⋮ requests only that file's immutable head source through `forge.fileContent@1`. While loading or when the source cannot be aligned the patch stays visible. Collapse restores the compact patch, and the choice is remembered for each head and path during the route session; guide stops stay in recorded-patch mode, per-file line statistics in the tree, drafts with per-axis badges, the one line composer, the review dock and Submit sheet), and agent scenarios started from catalog actions. A line tap in Files or a guide stop's Comment opens only `features/review` `LineCommentFrame`'s composer, docked at the bottom of the Changes pane under the toolbar and above the keyboard (the WebView editor has no inline composer and only highlights the anchor line), with dictation through the route-supplied `voiceRuntime` (the app's retained voice controller scoped to this PR). A line comment is always a PR review draft; there is no destination picker and no remembered destination. Adding a draft is optimistic: the composer closes at once and the draft appears inline and in the file's drafts, its text shimmering, from `data/reviewDraftPuts` while `putDraft` runs in the background; the acknowledged draft replaces it in the drafts query, and a refusal shows the Companion's reason on the draft (inline and on its card, which unfolds) with Edit (reopens the docked composer at its line with its text) and Discard. The review dock is never touched by a send. Opening the linked chat is navigation and must not start a scenario or enqueue input. `LinkedChatButton` carries the unread dot while `overview.reviewThread` is unread in the thread catalog (the route-supplied `isThreadUnread` reader); reading that chat clears it. PR descriptions and activity comment bodies use the shared complete-document Markdown renderer from `rendering/**`; this feature must not recreate, truncate or downgrade that pipeline to plain text.

Manual check actions are discovered only while the Checks sheet is mounted and the provider advertises `forge.checkTriggers@1`. The native picker opens over the mounted Checks sheet and keeps search, disclosure and list position. Its independent checkboxes use the provider's labels; tapping a job viewer never launches an action. Submission sends each selected check/action id for its captured PR head once, with its own idempotency key. Results remain per action, including an uncertain outcome after a lost reply. The current catalog refreshes when the picker opens and when a submitted batch settles.

A PR has one conversation. Agent scenarios started from catalog actions (`reviewPr`,
`addressComments`, `fixCi`, `rebase`) always send the `reviewChat` target; the companion resolves
it to the same canonical thread `ensureReviewChat` returns (never an archived thread) and creates
and records one when none is live. The screen never chooses among `overview.links` or asks the user
which thread to continue in. The chat button passes the overview's `reviewThread` to
`openReviewChat`; route composition opens that chat, or the review-chat draft when there is none.
Scenario starts send `workspace: ask`: while no live chat exists the companion answers
`needsWorkspace`, and the route-owned `deferReviewChatScenario` intent holds the scenario in that
draft (the first candidate pre-selected, none without a checkout) until the user confirms a
project; the confirmed directory is sent as `workspace: path` with a new idempotency key
(`reviewChatWorkspace.ts`). The action stays pending meanwhile; closing the draft starts nothing
and changes nothing. A started scenario opens its result thread through the same
`navigation.openThread` route intent that presents the canonical review chat.

Scenario run state is the Companion's: `forge.scenarios` (`companion/pullRequest/scenarios/read`,
invalidated by the `pullRequest` and `scenarios` events, never persisted) lists each slot's
`idle | queued | running | done | failed`; `actions/scenarioRuns.ts` maps it onto the catalog for
the shown head and `ScenarioViewsContext` hands it to every `CatalogActionButton`. A tap marks the
action pending at once (label shimmers in place, the button is disabled, a second tap is ignored)
until the Companion answers; the Companion itself joins a start to the queued or running run of the
same intent and head. A queued or running run shows `Reviewing…` (or its kind's phrase) shimmering
and its tap opens that run's chat; a run done at the shown head shows `Reviewed · 5m ago` and a tap
starts it again without confirmation; a run done at an older head shows the plain label; a failed
run keeps the plain label and its real reason appears in an app notice above the workspace.

Pulling the Details page down (`RefreshControl` on its scroll view) runs `refreshPullRequest`: it
invalidates the process-owned overview, activity, conversation, scenarios, files-at-head, drafts
and guide queries. Shown queries refetch in place with their published data still visible; the
rest are re-read when shown. The indicator is the pending async Transition and ends when the shown
refetches settle; failures surface through each query's own error state. Changes has no React
Native scroll container (the review editor owns its scrolling), so it has no pull gesture.

The linked-chat action only chooses or creates the PR-linked thread. Route composition presents that
thread through the canonical `ActiveWorkspaceConversation`; the PR feature must not own or copy
conversation rows, bubbles, renderers, activity, composer state or composer controls. On every
desktop layout (an unfolded Fold included) the review chat stays in a pane beside the retained PR,
and the shared pane frame lets that right pane cover the catalog while it is open (the catalog and
the chat are never visible together). Only a phone (non-desktop) layout opens the canonical thread
through the parent Tabs navigator, preserving ensure, attempt fencing, `prepareThreadLink`,
cancel/retry and the original `dialog.error`. The chat publishes no presentation claim and owns no
tab selection, navigation or pane-layout state.

Verdicts on Details follow the enabled provider default. The primary button and its alternatives submit an enabled `quickSubmit` verdict directly against the displayed head with an empty draft list. The provider must opt in and declare no input or confirmation. Other verdicts open the review composer. Its verdict selector never publishes on selection. A lone composer verdict lives in the overflow menu. Changes offers explicit publication of drafts, a summary and optional agent forwarding. Offline writes use the shared refusal dialog.

Pure policies: `actions/actionSlotting.ts` (phone 1 + 2, tablet 2 + 3, measured width, anchored targets including `checksSection` on an open or draft PR, verdicts to the dock and the Details verdict button, merge kinds to the merge card; an unknown anchor arrives as `null` with `overflow` placement) and `actions/confirmationPolicy.ts` (kind floors only raise a level). The runner (`actions/useActionRunner.ts`) confirms at the effective level, keeps one idempotency key per intent across a transport failure, and recovers by code: a moved head shows an app notice and refreshes; a forge refusal restores the forge's state and shows its reason. The native RPC bridge carries no JSON-RPC `data`, so recovery re-reads resources instead of trusting error payloads.

State: Details and Changes are separate canonical routes, and the route passes the selected tab into the screen. `pullRequestScreenModel` is one Legend observable per mounted route session (Files/Guide, selected file, pending runs and toggles, notice, the verdict the Details Submit sheet is open with); it never duplicates route state or resource data. Files, drafts and the guide are progressive resources read during render.

Every forge write has one trigger here: catalog actions through `action/run`, verdicts and review drafts through the review submit RPC (a standalone approval on Details or explicit submission from the review composer), a top-level conversation comment only through the Comment pill's composer sheet (`comment/create`; an acknowledged comment closes the sheet), a thread reply only through that thread's reply input (`reviewThread/reply`), a conversation's resolution only through that thread's Resolve/Unresolve button (`reviewThread/resolve`: the label shimmers in place while pending, success patches the thread's resolution into the conversation query and folds a resolved thread, a failure shows the forge's reason under the button), and the exact attention revision through a post-commit display acknowledgement. A conversation comment and a thread reply publish immediately, as on the forge; diff line comments and whole-file comments stay drafts until Submit review. The conversation writes carry an idempotency key kept only across a transport failure (a resolve's intent includes the target state), patch the acknowledged comment or resolution into the conversation query and let the settled mutation invalidate it. The attention acknowledgement is replay-safe and may remain queued offline; other offline writes are refused locally with the shared offline dialog and nothing else is queued.

Conversation (see the [contract](../../../../../docs/forge-conversation.md)): when the PR account's
plugin declares `forge.conversation@1` in the accounts snapshot, Details renders
`conversation/ConversationSection` instead of `ActivitySection`; without it, or when the companion
answers that it cannot serve the read, the activity list stays. The process-owned
`forge.conversation` query is read during render and never runs for an undeclared plugin.
`conversation/conversationContent.ts` maps the DTOs into the forge-independent
`features/messageContent` model, and `conversation/discussionModel.ts` projects the loaded pages
(once per render, in `OverviewTab`) into the issues (open first, settled behind a counter, each
newest first) and their Status summary, each reviewer's standing verdict for the Reviews row, and
the timeline, newest first exactly as the pages arrive (the forge sends the
newest entries on the first page and older ones on later pages; a thread's own comments stay
oldest first): reviews containing their threads by `reviewId` (a thread on a later page joins its
already loaded review), verdict-only reviews as rows, comment groups of one author within five
minutes (newest first, the newest carrying the header), collapsed same-category event runs
(showing the newest age). The Conversation band ("Conversation N", "Newest first") renders the
timeline as full-width items separated by hairlines, never cards: comments (avatar, `login · age`,
an outlined Bot/AI badge, the body below folded behind "Read more" when long), one-line event and
verdict rows (glyph in a tinted circle, small avatar, login, verb, age), reviews as a verdict row
with their text and threads, thread blocks (a file header with the anchor, the iteration only when
older than the newest, Outdated and the state as dot and word; collapsed while settled; replies,
with `forge.comments@1` and `viewerCanReply` a reply input, anchored catalog actions and "Address
in agent"; a thread with a forge code `excerpt` draws it first in its body, monospace with old and
new line gutters, `+`/`-` markers, added and removed tints and the anchored lines barred, scrolling
sideways instead of wrapping; with `forge.conversation.resolve@1` and the conversation's
`viewerCanToggle`, "Resolve conversation" or "Unresolve conversation") and push event rows list
their commits (short id in code type, the title, "and N more commits" when the forge capped the
list), then "Show more discussion" at the end, which appends the next, older page below. An acknowledged top-level comment is patched in at the
top of the loaded pages.
Details mounts the discussion body when its heading is within 200 dp below the viewport, then adds
rows as the reader scrolls. Mounted rows keep their state when scrolled out of view. The Issues and Reviews summaries use the entire loaded page. Selecting an issue also
mounts its row so the page can scroll to the thread. “Show more discussion” follows the last
locally loaded row and requests the next page from the forge.
`conversation/discussionNavigator.ts` is the Details page's Legend-backed owner of per-thread
expansion and of revealing a thread from the Issues row ("View code") (expand, then scroll the Details page
measured from its page view). "Address in agent", on a thread or an issue in the Issues row, starts
`addressComments` with that thread's `reviewThreadId` in the canonical review chat and opens the
result like every scenario. The screen
mounts one `PrivateImageAccessProvider` over the companion media access, so description and
comment images load; pending text shimmers in place and no spinner is shown. Inside the
conversation, `conversation/conversationImages.ts` turns the page's plugin-marked `media` and
`avatarDirect` avatars into a `DirectImageSourcesProvider`: those images load directly on the phone,
cached by their stable source in the connection scope; an expired, uncached URL re-reads the
conversation query once. Unmarked images keep the companion path.

Placement: the screen is position-agnostic. It paints no background of its own (nor does its
skeleton) and inherits the surface of the pane it is placed in: the center surface on the PR route,
the frame surface in a thread's right pane. Colors that must match that surface (the folded-message
fade, the unread ring) come from `ui/surfaceTone`, and no section band or thread header paints the
pane surface. Its app bar is a `ThreePanelsHeader`: Details supplies an `exit` Back only where the
route has one. The shared header shows it on a stacked screen. Changes supplies a `nested` Back
to Details in every layout. The pane's `×` comes from `ThreePanelsContext`. The linked-chat button is absent while the neighbouring pane shows a
conversation. The screen never takes pane position, close or chat visibility as props.

Boundaries: may import `features/review` public modules (editor, line comment frame, draft card, guide
panel, review target capabilities) and `features/messageContent` public modules; must not import `features/pullRequests`, Expo Router, route
files, the parent `(tabs)` layout or `CatalogModeBarHost`. Details and Changes remain route-owned
canonical sibling URLs. The feature does not mirror the active tab, retain a second linked-thread
snapshot or make tab blur a resource-lifetime signal.

Files changed places the icon-only guide and diff preferences in the PR header. File navigation and the selected file’s actions share the row below it. Review and linked chat float above the reading surface and yield to the file chooser and comment composer. Whole-file comments require `forge.review.file@1`. Their draft anchor carries the path and `kind: "file"`.
