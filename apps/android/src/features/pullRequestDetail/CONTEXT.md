# V1 pull request screen

Public surfaces: `PullRequestScreen`, `PullRequestScreenSkeleton` and `pullRequestScreenContract`. Route composition publishes the destination immediately; the screen suspends on the process-owned overview query behind its own stable skeleton, so the adjacent catalog does not disappear while the detail loads.

The screen owns: the app bar, the Details | Changes tabs, the Details reading surface (one column at every width: the full title, state pill, `author wants to merge into base from head` and stats; the action row; the description; then full-width GitHub Mobile style sections under grey bands: Changes (Files changed, Review guide), Status (`sections/StatusSection`: an Issues row with the open forge issues, a Reviews row with each reviewer's standing verdict from the loaded conversation, a Checks row listing the failing checks inline with every check in its sheet, and the merge-state row with conflict actions, the merge method and auto-merge controls; checks are summarized only once) and the Conversation or activity. Merged and closed PRs show no checks or merge rows. A floating Comment pill beside the linked-chat button opens the new-comment composer sheet, and the page keeps clearance below its last entry. The app bar's single ⋯ holds every overflowed action and Open on forge on both tabs), the Changes work surface (Files | Guide over the forge diff; with `forge.fileContent@1` the selected file shows whole with its changes inline once the process-owned `forge.fileContent` query (keyed by connection, PR, head and path, read during render, never polled or persisted) returns text that lines up with the patch, and stays in recorded-patch mode while it loads and for every other answer; guide stops stay in recorded-patch mode, viewed marks with their source, drafts with per-axis badges, the comment sheet, the review dock and Submit sheet), and agent scenarios started from catalog actions. Opening the linked chat is navigation and must not start a scenario or enqueue input. `LinkedChatButton` carries the unread dot while `overview.reviewThread` is unread in the thread catalog (the route-supplied `isThreadUnread` reader); reading that chat clears it. PR descriptions and activity comment bodies use the shared complete-document Markdown renderer from `rendering/**`; this feature must not recreate, truncate or downgrade that pipeline to plain text.

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
run keeps the plain label and its real reason appears through the action notice banner.

The linked-chat action only chooses or creates the PR-linked thread. Route composition presents that
thread through the canonical `ActiveWorkspaceConversation`; the PR feature must not own or copy
conversation rows, bubbles, renderers, activity, composer state or composer controls. On every
desktop layout (an unfolded Fold included) the review chat stays in a pane beside the retained PR;
below the three-pane width (1200dp) that pane takes the catalog's place. Only a phone (non-desktop)
layout opens the canonical thread through the parent Tabs navigator, preserving ensure, attempt
fencing, `prepareThreadLink`, cancel/retry and the original `dialog.error`. An opening or open chat
that takes the catalog's place may publish only the `pullRequestChatClaimsCatalog` presentation
claim; it does not own tab selection or navigation state, and a three-pane chat must not hide the
shared catalog bar.

Pure policies: `actions/actionSlotting.ts` (phone 1 + 2, tablet 2 + 3, measured width, anchored targets, verdicts to the dock, merge kinds to the merge card) and `actions/confirmationPolicy.ts` (kind floors only raise a level). The runner (`actions/useActionRunner.ts`) confirms at the effective level, keeps one idempotency key per intent across a transport failure, and recovers by code: a moved head shows the stale banner and refreshes; a forge refusal restores the forge's state and shows its reason. The native RPC bridge carries no JSON-RPC `data`, so recovery re-reads resources instead of trusting error payloads.

State: Details and Changes are separate canonical routes, and the route passes the selected tab into the screen. `pullRequestScreenModel` is one Legend observable per mounted route session (Files/Guide, selected file, pending runs and toggles, notice); it never duplicates route state or resource data. Files, drafts and the guide are progressive resources read during render.

Every forge write has one trigger here: catalog actions through `action/run`, review comments and the verdict only through Submit review, viewed marks only through the file row toggle, a top-level conversation comment only through the Comment pill's composer sheet (`comment/create`; an acknowledged comment closes the sheet), a thread reply only through that thread's reply input (`reviewThread/reply`), a conversation's resolution only through that thread's Resolve/Unresolve button (`reviewThread/resolve`: the label shimmers in place while pending, success patches the thread's resolution into the conversation query and folds a resolved thread, a failure shows the forge's reason under the button), and the exact attention revision through a post-commit display acknowledgement. A conversation comment and a thread reply publish immediately, as on the forge; diff line comments stay drafts until Submit review. The conversation writes carry an idempotency key kept only across a transport failure (a resolve's intent includes the target state), patch the acknowledged comment or resolution into the conversation query and let the settled mutation invalidate it. The attention acknowledgement is replay-safe and may remain queued offline; other offline writes are refused locally with the shared offline dialog and nothing else is queued.

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

Boundaries: may import `features/review` public modules (editor, comment sheet, draft card, guide
panel, review target capabilities) and `features/messageContent` public modules; must not import `features/pullRequests`, Expo Router, route
files, the parent `(tabs)` layout or `CatalogModeBarHost`. Details and Changes remain route-owned
canonical sibling URLs. The feature does not mirror the active tab, retain a second linked-thread
snapshot or make tab blur a resource-lifetime signal.
