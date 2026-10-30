# Pull request conversation: reading, rendering and replying

Status: contract of `forge.conversation@1` and `forge.conversation.resolve@1` (revised in place
before release: typed anchors, resolutions with issues, verdicts, iterations, author kinds, event
categories, code excerpts, conversation resolution and push commits). The plugin,
companion and Android sides implement exactly these shapes; changing them changes all three. There
is no compatibility layer for the earlier flat shape (`path`/`line`/`side`/`resolved` on a thread).

## Goal

The Details tab renders a pull request's conversation, the Discussion (top-level comments, reviews
containing their threads, issues, verdicts and timeline events), with rich Markdown, avatars,
reactions, resolved/issue/outdated state, iterations and the images embedded in comment bodies.
It serves GitHub (resolvable conversations) and Arcanum (issues: comment remarks that are open,
resolved or dropped, written on iterations). The user can address the conversation:

- write a top-level comment;
- reply in a review thread;
- resolve or unresolve a conversation (a thread whose resolution is `conversation`);
- hand one review thread or issue to the agent (the existing `addressComments` scenario, focused
  on that thread, in the PR's canonical review chat).

Out of scope for this step: reactions writes, edit/delete, changing an issue's state, attachment
upload, and an outcome (success/failure) on `ci` events. Reactions and issues are read and displayed only.

## Write rule

A conversation comment, a thread reply and a resolution change publish immediately, as on the
forge itself. Line
comments on the diff remain drafts that reach the forge only through Submit review. Offline,
every write is refused locally and nothing is queued. Every write carries an `idempotencyKey`; the
companion journals it before calling the plugin and replays the stored outcome for a repeated key,
exactly like `action/run`.

## Plugin capabilities and methods (forge-protocol)

Optional capabilities, declared by the plugin:

- `forge.conversation@1`: `forge.pullRequest.conversation` and `forge.media.read`.
- `forge.comments@1`: `forge.pullRequest.comment.create` and `forge.pullRequest.reviewThread.reply`.
- `forge.conversation.resolve@1`: `forge.pullRequest.reviewThread.resolve`. Unrelated to
  `forge.resolve@1` (remote → repository resolution).

The companion rejects undeclared capabilities with `-32080`. Android branches only on declared
capabilities, never on the forge's name.

### `forge.pullRequest.conversation`

Params: `{ account, ref, cursor: string | null }`.

Result `ConversationPage`:

```jsonc
{
  "entries": [ /* ConversationEntry, newest first */ ],
  "nextCursor": "opaque", // older entries, or null when none are left
  "openIssuesBlockMerge": true // boolean | null, see below
}
```

`openIssuesBlockMerge` says whether an open issue (a thread whose `resolution.kind` is `issue`
and whose `state` is `open`) prevents merging this pull request: `true` or `false` when the forge
knows, `null` when the forge has no such rule or cannot tell (GitHub always sends `null`). Every
page of one read carries the same value; the client uses the first page's.

`ConversationEntry` is a union on `kind`:

```jsonc
{ "kind": "comment", "comment": Comment }
{ "kind": "review", "id": "…", "author": Author, "createdAt": "RFC3339",
  "verdict": ReviewVerdict,
  "body": Comment | null }               // the review's own summary body, if any
{ "kind": "reviewThread", "thread": ReviewThread }
{ "kind": "event", "id": "…", "author": Author | null, "createdAt": "RFC3339",
  "category": "push" | "state" | "ci" | "other",
  "text": "plain text, e.g. added 3 commits",
  "commits": EventCommits }             // optional, absent (or null) when none; push events only
```

```jsonc
ReviewVerdict =
    "approved"            // the reviewer approved
  | "changesRequested"    // the reviewer asked for changes
  | "commented"           // a review with no verdict, only a body and/or inline threads
  | "dismissed"           // a review the forge dismissed
  | "mergeBlocked"        // the reviewer blocked the merge (Arcanum "Block"/"Ship: no")
  | "mergeUnblocked"      // the reviewer lifted their own block
  | "approvalWithdrawn"   // the reviewer took back an earlier approval

Author = {
  "login": "octocat",
  "kind": "user" | "bot" | "ai",        // always present
  "avatarUrl": "https://…" | null,
  "avatarDirect": true                  // optional, default false: the avatar is public
}

Comment = {
  "id": "opaque provider id",
  "author": Author,
  "createdAt": "RFC3339",
  "updatedAt": "RFC3339" | null,        // null when never edited
  "body": "raw Markdown as authored",   // may embed HTML and forge-hosted image URLs
  "url": "https://… web permalink" | null,
  "reactions": [Reaction],              // only reactions with count > 0
  "media": [CommentMedia]               // optional, default []
}

CommentMedia = {
  "source": "image URL exactly as written in body",
  "url": "https://… credential-free signed or public URL",
  "expiresAt": "RFC3339" | null         // null when url does not expire
}

Reaction = {
  "content": "thumbsUp" | "thumbsDown" | "laugh" | "hooray" | "confused" | "heart" | "rocket" | "eyes",
  "count": 3,
  "viewerReacted": true
}

ReviewThread = {
  "id": "opaque provider thread id",     // the id `reviewThread.reply` and scenarios accept
  "anchor": ThreadAnchor,
  "outdated": false,                     // the anchored code changed since the thread started
  "resolution": ThreadResolution,
  "reviewId": "…" | null,                // the `review` entry this thread was published with
  "iteration": { "id": "…", "number": 3 } | null, // the iteration it was written on
  "comments": [Comment],                 // oldest first, at least one
  "viewerCanReply": true,
  "excerpt": CodeExcerpt                 // optional, absent (or null) when unknown
}

ThreadAnchor =
    { "kind": "pullRequest" }                       // the whole pull request
  | { "kind": "file", "path": "src/file.rs" }       // a file, no line (or no longer mappable)
  | { "kind": "line", "path": "src/file.rs",
      "line": 42,                                   // the last line, 1-based
      "startLine": 40 | null,                       // the first line of a range; null for one line
      "side": "new" | "old" }

ThreadResolution =
    { "kind": "none" }                              // the forge cannot resolve this thread
  | { "kind": "conversation", "resolved": false,    // a resolvable discussion (GitHub)
      "viewerCanToggle": true }                     // optional, default false, see below
  | { "kind": "issue",                              // a review remark with a lifecycle (Arcanum)
      "state": "open" | "resolved" | "dropped",
      "changedBy": Author | null,                   // who last changed the state, if known
      "changedAt": "RFC3339" | null }

CodeExcerpt = {
  "lines": [ExcerptLine]                            // 1..8, top to bottom; the last is the anchored line
}

ExcerptLine =
    { "kind": "context", "oldLine": 40, "newLine": 41, "text": "unchanged code" }
  | { "kind": "added",   "newLine": 42, "text": "added code" }
  | { "kind": "removed", "oldLine": 39, "text": "removed code" }

EventCommits = {
  "total": 25,                                      // every commit of the push, >= items.length
  "items": [EventCommit]                            // 1..20, oldest first, the first 20 of the push
}

EventCommit = {
  "sha": "full commit id",                          // 1..64 ASCII letters and digits
  "shortSha": "abc1234" | null,                     // 1..16 ASCII letters and digits; the client abbreviates when null
  "title": "first line of the message",             // one line, at most 256 characters
  "authorLogin": "octocat" | null                   // the forge login of the commit's author, if known
}
```

Rules every plugin keeps:

- **Entry order.** Entries are ordered by `createdAt` of the entry (a thread by its first
  comment), newest first, within and across pages: the first page (`cursor: null`) holds the
  newest entries, and `nextCursor` continues to older ones, so the last entry of a page is at
  least as new as the first entry of the next. Entries with the same `createdAt` may come in any
  order. A thread's `comments` stay oldest first: a thread reads top-down, and a reply does not
  move its thread. Instants are compared, not strings: `2026-10-01T03:00:00+03:00` and
  `2026-10-01T00:00:00Z` are equal.
- **Reviews and threads.** A review's inline comments appear in their `reviewThread` entries, never
  inside the `review` entry. `reviewId` links a thread to the `review` entry it was published
  with, so the client can draw the thread inside that review; it is `null` for a thread started
  outside a review. A `reviewId` whose review is not (yet) in the loaded pages is legal: the client
  then shows the thread on its own at its position. A plugin may omit a review entry that has no
  verdict and no body.
- **Anchors.** `startLine` is `null` or strictly less than `line`; lines are positive. A thread
  whose line can no longer be mapped keeps its path as a `file` anchor and sets `outdated`.
  `outdated` is independent of the anchor kind.
- **Issues.** "Issue" means a review remark with its own lifecycle (Arcanum's comment issues), not
  a tracker ticket. Issues are read-only in this contract; the only action on an issue is the
  focused `addressComments` scenario. `changedBy`/`changedAt` describe the latest state change
  (for `open`, a reopen, or `null` when never changed).
- **Iterations.** `iteration` is the forge's revision of the pull request the thread was written
  on (Arcanum iterations); `number` is positive and increases with time. Forges without
  iterations send `null`. The client treats the largest `number` it has seen as the latest.
- **Author kind.** `bot` is an automation account (a GitHub App, a robot user); `ai` is an AI
  reviewer that the forge identifies as one; everything else is `user`.
- **Event category.** `push`: new commits or a new iteration (push, force-push, iteration
  upload); `state`: the pull request's own state (opened, closed, reopened, merged, draft, ready);
  `ci`: checks and pipelines; `other`: everything else (review requests, labels, links).
- **Verdicts.** A verdict-only review (no body, no threads) is a valid entry; the client shows it
  as a compact row.
- **Code excerpt.** `excerpt` is the code the thread is about, as the forge's diff showed it when
  the thread started: at most 8 lines ending at the anchored line, each with the line numbers its
  kind has (`context` both, `added` the new side's, `removed` the old side's). Lines are one
  contiguous piece of one diff hunk, so each side's numbers grow by exactly one from one line
  carrying that side to the next. Texts are single lines (a tab is allowed, no other control
  character) of at most 400 characters; the plugin cuts longer lines. Only a `line` or `file`
  anchor has an excerpt. For a `line` anchor the last line exists on the anchor's `side` with the
  anchor's `line` (so a thread whose line moved since gets no excerpt unless the plugin renumbers
  it correctly); for a `file` anchor (a line that no longer maps) the excerpt shows the code as it
  was, numbered as it was. A `pullRequest` thread has none. The client marks the last line, and
  for a range (`startLine`) every excerpt line whose number on the anchor's side is within
  `startLine..line`. The rules are `CodeExcerpt::rules` in `crates/forge-protocol`.
- **Conversation resolution.** `viewerCanToggle` says the viewer may flip `resolved` through
  `forge.pullRequest.reviewThread.resolve`: resolve it while unresolved, unresolve it while
  resolved. A plugin without `forge.conversation.resolve@1` omits it (false). Issues and `none`
  threads are never resolved through this write.
- **Push commits.** A `push` event may list the commits it added: `items` oldest first, cut to the
  first 20, and `total` counting all of them. A force-push lists the new head commit. Only `push`
  events carry `commits`; the rules are `EventCommits::rules` in `crates/forge-protocol`.

### Direct media

The companion does not download forge media for the conversation when the plugin can hand out a
credential-free URL. `Comment.media` maps an image URL of `body` (`source`, verbatim) to a URL the
client fetches directly (`url`), with the URL's expiry. `Author.avatarDirect` marks a public
avatar. The plugin never puts its own credential into these URLs. An image without an entry, and
an avatar without the mark, keep `forge.media.read` through the companion.

The companion keeps a `media` entry only when `url` is `https` on the default port, without user
info, on exactly one of the provider's declared `mediaHosts`, `source` and `url` are single-line
and at most 8 KiB, `expiresAt` is RFC 3339 or `null`, and `source` is not repeated; at most 32
entries per comment. `avatarDirect` survives only for an `https` avatar on a declared media host.
Everything else is dropped silently, so the image keeps the plugin path. The acknowledged comment of
a write carries no `media` (the journal stores it for replay; the conversation read that follows
the write carries fresh URLs).

### `forge.media.read`

Params: `{ account, url }`. The plugin fetches a forge-hosted media URL with its own credential.
It must refuse any URL whose host is not one of the account's forge or media hosts.

Result: `{ "contentType": "image/png", "bytesBase64": "…" }`, at most 10 MiB; larger media are
refused with an explicit error. Tokens never leave the plugin.

### `forge.pullRequest.comment.create`

Params: `{ account, ref, body, idempotencyKey }` → `{ "comment": Comment }`.

### `forge.pullRequest.reviewThread.reply`

Params: `{ account, ref, threadId, body, idempotencyKey }` → `{ "comment": Comment }`.

`body` is Markdown, 1..65536 characters after trimming; the companion validates the bound.

### `forge.pullRequest.reviewThread.resolve`

Params: `{ account, ref, threadId, resolved: boolean, idempotencyKey }` →
`{ "resolved": boolean, "viewerCanToggle": boolean }`, the thread's conversation resolution after
the write. `resolved: true` resolves, `false` unresolves.

- A thread already in the requested state answers that state without writing (a stale screen is
  not an error).
- A thread of another pull request, or an unknown one, answers `-32115`.
- A thread whose resolution is not `conversation` (an issue, `none`), or a change the viewer may
  not make, answers `-32113` with the forge's reason and writes nothing.

## Companion RPCs (Android ↔ companion)

- `companion/pullRequest/conversation/read` `{ pullRequest, cursor }` → `ConversationPage`.
  Cached and invalidated like activity; a successful write invalidates it and emits the PR event.
- `companion/pullRequest/comment/create` `{ pullRequest, body, idempotencyKey }` → `{ comment }`.
- `companion/pullRequest/reviewThread/reply`
  `{ pullRequest, threadId, body, idempotencyKey }` → `{ comment }`.
- `companion/pullRequest/reviewThread/resolve`
  `{ pullRequest, threadId, resolved, idempotencyKey }` → `{ resolved, viewerCanToggle }`;
  `-32080` without `forge.conversation.resolve@1`, `-32088` for an unknown thread, `-32083` for a
  refusal or an unknown outcome.
- `companion/pullRequest/scenario/start` gains an optional `reviewThreadId`. With it, the
  `addressComments` scenario context contains only that thread (its comments, its anchor as
  `location`: `path:start-end`, `path:line`, the path or `pull request`, its diff `side` or `none`,
  and its `state`: `open`, `resolved`, `open issue`, `resolved issue` or `dropped issue`, with
  `, outdated` appended) and goes to the canonical review chat like every scenario. Issues use the
  same id space as threads, so "Address in agent" on an issue sends its thread id.
- Forge-hosted images in comment bodies: the companion media path (`/v1/media/materialize`)
  routes a URL whose host belongs to a connected forge account declaring `forge.conversation@1`
  through `forge.media.read` instead of an anonymous fetch. Every other URL keeps the existing
  path.

Errors use the existing forge error codes (offline/refused/capability unavailable). An
interrupted write ends as `outcomeUnknown` and needs a fresh read and a new key.

## Backend implementation notes

Additions the shapes above needed:

- **`mediaHosts` in `initialize`** (optional, omitted when empty). The companion must route a
  forge-hosted image URL to a plugin without branching on the forge's name, but GitHub's image
  hosts (`*.githubusercontent.com`) are not the account host. A URL belongs to an account when its
  host is the account's host, one of its subdomains, or one of the provider's declared
  `mediaHosts`. Accounts on the host itself are asked first.
- **`forge.media.read` refusals.** A URL outside the account's forge and media hosts, or a redirect
  to one, answers `-32602`; the companion then asks the provider's next account and, when every
  candidate refuses, keeps its anonymous fetch for that URL (no credential is involved there).
  Media above 10 MiB answer `-32113` with `data.kind = "tooLarge"`. Any other failure of an owned
  URL is final; there is no anonymous retry. The companion re-applies its own media rules (image
  magic, its size bound, owner-scoped cache).
- **Bodies.** The companion validates 1..65 536 characters after trimming and sends the trimmed
  body.
- **Journal.** Comment writes use the action journal with kinds `comment` (`actionId` `comment`)
  and `reviewThreadReply` (`actionId` the thread id), and resolution changes kind
  `reviewThreadResolve` (`actionId` `resolved:<threadId>` or `unresolved:<threadId>`), so a key
  reused for another write, thread or direction is refused. The capability is checked before journaling, so an undeclared capability consumes no
  key. A local failure after the call started (timeout, a plugin that died) and a success whose
  comment fails validation are `outcomeUnknown`. Success and `outcomeUnknown` invalidate the pull
  request (cache and `pullRequest` event); a typed refusal does not.
- **Validation.** The companion re-checks every page before a client sees it: a thread without a
  valid id, without a valid comment, or with an impossible anchor (an empty, control-character or
  over-4 KiB path, line 0, or a `startLine` not strictly before `line`) is dropped; an invalid
  `reviewId` and an iteration with an invalid id or number 0 become `null`; an issue's `changedBy`
  is checked like every author and an unreadable `changedAt` becomes `null`. An `excerpt` that
  breaks `CodeExcerpt::rules` for its anchor, and `commits` that break `EventCommits::rules` (on a
  non-`push` event, empty, over 20, `total` below the item count, a malformed id, a multi-line or
  over-long title), are dropped; their thread or event stays. `Author.kind`,
  verdicts, event categories and `openIssuesBlockMerge` are closed enums or booleans checked by
  the decoder; an unknown value rejects the page.
- **Caching.** Conversation pages are cached per pull request and cursor for the overview's 60 s
  window and dropped by every pull request invalidation. The cached page is the validated page,
  `openIssuesBlockMerge` included. The focused scenario never uses the cache.
- **Focused scenario.** The thread is looked up in at most 20 conversation pages before the run is
  journaled; an unknown thread answers `-32088`. `reviewThreadId` with any scenario other than
  `addressComments` is `-32602`. The context carries only the thread; the PR description stays out.
- **GitHub plugin.** Both connections are read backwards from their newest item (GraphQL
  `last`/`before`, `pageInfo.hasPreviousPage`). One page reads at most 50 timeline items
  (comments, reviews and merge, close, reopen, force-push, ready-for-review, draft and
  review-request events) and 20 review threads, and emits entries only down to the latest point at
  which a connection with older pages stopped, so pages stay in global newest-first order; the
  cursor records, per connection, the oldest item emitted. A thread carries at most 250 comments (50 with the thread, then follow-up reads
  of 100); later comments are not returned. Thread ids are GraphQL `PullRequestReviewThread` node
  ids, comment ids GraphQL node ids. A `COMMENTED` review without a body and a pending review are
  omitted; their inline comments are in the threads. Mapping: a thread is a `line` anchor while
  GitHub's `line` maps and a `file` anchor otherwise (a file-level thread, or one outdated beyond
  mapping, with `outdated` from `isOutdated`); a single-line thread's repeated `startLine` becomes
  `null`; `isResolved` becomes `{ kind: "conversation", resolved }`; `reviewId` is the GraphQL
  `PullRequestReview` id of the thread's first comment (`pullRequestReview { id }`), which may name
  an omitted review; `iteration` and `openIssuesBlockMerge` are always `null`. An account whose
  GraphQL `__typename` (REST `type`) is `Bot` is `bot`, everything else `user`; GitHub has no
  separate AI marker. Force-push events are `push`; merged, closed, reopened, ready-for-review and
  draft events are `state`; review requests are `other`. GitHub never emits `mergeBlocked`,
  `mergeUnblocked` or `approvalWithdrawn`. `forge.media.read` sends the token only to the
  account's web origin (`https://github.com`, or the Enterprise host) and never to image hosts,
  follows at most 5 redirects by hand, and refuses a hop outside the allowlist before requesting it.
  Whether `github.com/user-attachments` honours a bearer token for private repositories is not yet
  verified against live GitHub; a public attachment that redirects outside the allowlist falls back
  to the anonymous fetch.
- **GitHub excerpts, resolution and pushes.** The excerpt is the tail of the thread's first
  comment's `diffHunk` (read once per thread as `opening: comments(first: 1) { nodes { diffHunk } }`),
  numbered from its `@@` header, at most 8 lines, text cut to 400 characters with control
  characters other than a tab replaced by U+FFFD. GitHub numbers the hunk as the diff was when the
  comment was written; when that no longer ends at the thread's current `line`, the thread gets no
  excerpt. An outdated thread (a `file` anchor) keeps the original hunk. `viewerCanToggle` is
  `viewerCanUnresolve` for a resolved thread and `viewerCanResolve` for an unresolved one;
  `forge.pullRequest.reviewThread.resolve` reads the thread (its pull request, `isResolved` and
  both permissions), answers the current state without a write when it already matches, refuses
  with `-32113` a change the viewer may not make, and otherwise runs `resolveReviewThread` or
  `unresolveReviewThread`. The timeline also reads `PullRequestCommit` items (they count towards
  the 50 items of a page): consecutive commits by the same author (`commit.author.user.login`)
  with no other timeline item between them become one `push` event, "added N commits", with the
  newest commit's node id, author and `committedDate` and the commits oldest first (`oid`,
  `abbreviatedOid`, `messageHeadline`); a push that straddles a page boundary shows as two events.
  A force-push reads "force-pushed the head branch from `<before>` to `<after>`" (abbreviated ids)
  and lists the new head commit. GitHub's timeline has no check or workflow items, so GitHub sends
  no `ci` events.
- **GitHub activity.** `forge.pullRequest.activity` (and the first page embedded in
  `forge.pullRequest.read`) is a projection of the same conversation page and cursor: issue
  comments, reviews (with their verdict label and body) and every review-thread comment (with the
  thread id, path and line), newest first within the page; events are not activity. A reply stays
  on the page of its thread, which is placed by the thread's first comment.
- **GitHub direct media.** Every conversation comment is read with its GraphQL `bodyHTML`. GitHub
  renders an attachment (`github.com/user-attachments/assets/<uuid>`, the older
  `github.com/<owner>/<repo>/assets/<id>/<uuid>` form, or a pasted `private-user-images` URL) as
  `https://private-user-images.githubusercontent.com/…<uuid>…?jwt=…`, a signed URL that needs no
  credential. The plugin pairs each such source with the `<img src>` whose path contains the same
  UUID and takes `expiresAt` from the JWT's `exp` (unverified; a hint for the client). A
  `user-images.githubusercontent.com` URL, and a `raw.githubusercontent.com` URL of a public
  repository (`isPrivate: false`), rendered unchanged, is direct with `expiresAt: null`. A rendered
  URL with a `token` parameter, an attachment GitHub leaves unsigned (animated images), camo-proxied
  and non-GitHub images get no entry. `avatarDirect` is set for `https://avatars.githubusercontent.com`
  avatars. Observed on live github.com (public repositories, 2026-10): signed URLs live 300 s, load
  with HTTP 200 and no `Authorization` header, and answer 404 once expired. Not yet observed for a
  private repository, because no private test PR with an attachment exists.

## Android

- `features/messageContent` owns the forge-independent message content model and its rendering:
  `MessageContent = { markdown, attachments }`, `MessageBody` (Markdown through the shared
  `CompleteMarkdown`, images through the private image access path), `MessageCard` (avatar beside
  `login · age`, an outlined `Bot` / `AI` badge under the login, the body at full width below,
  folded behind a fade and "Read more" when long, and read-only reactions) and `MessageReplyInput`
  (Markdown input with Send; pending text shimmers in place). It imports only `rendering/**`,
  `ui/**`, `theme`, `data` content/image primitives and the composer's public Markdown input
  module. It must not import conversation, composer internals or any forge/PR feature. The chat
  and its bubbles are not changed by this step.
- `features/pullRequestDetail` maps `ConversationPage` into `MessageContent` and lays Details out
  in GitHub Mobile style: full-width sections under grey bands, rows separated by inset hairlines,
  no cards around comments. The Status band summarizes the page: an Issues row when the page has
  issues (`2 open · blocks merge` when `openIssuesBlockMerge` is `true`, `2 open`, or `No open
  issues`; expanded while one is open, each issue shows its anchor label `file:line`, file or
  "Pull request", its first line, who last changed it, "Address in agent" and "View code", which
  scrolls to its thread and expands it; resolved and dropped issues wait behind a counter), a
  Reviews row with each reviewer's newest approval or change request on the loaded pages, the
  Checks row and the merge state. The Conversation band ("Conversation N", "Newest first") draws
  the timeline newest first as the pages arrive (later pages append older entries below): a review
  as a one-line verdict row (glyph in a tinted circle, small avatar, login and verb, age) with its
  body below and the threads whose `reviewId` names it, a review without body and threads as the
  verdict row alone, top-level comments as messages (consecutive comments of one author at most
  five minutes apart share one header, carried by the newest; a group never spans a verdict,
  thread, review or event), and event rows whose consecutive same-category runs collapse ("3
  updates pushed", with the newest age). A thread is a bordered block with a file header (the
  anchor, the iteration only when it is older than the newest on the loaded pages, Outdated, and
  the state as a dot and a word: Unresolved, Resolved, Open issue, Dropped); its body starts with
  the code excerpt when the thread has one (monospace, old and new line-number gutters, `+`/`-`
  markers, added and removed lines tinted, the anchored lines marked, long lines scrolled
  sideways rather than wrapped), collapsing with the thread. Settled threads (resolved, or
  resolved/dropped issues) start collapsed; a thread keeps its replies, the reply input (with
  `forge.comments@1` and `viewerCanReply`), "Resolve conversation" / "Unresolve conversation"
  (with `forge.conversation.resolve@1`, a `conversation` resolution and `viewerCanToggle`; the
  label shimmers in place while pending, offline it is refused locally, a success patches the
  thread's resolution and a resolve collapses the thread, a failure restores the button and shows
  the forge's reason) and "Address in agent". A push event with `commits` lists them under its
  row: the short id (`shortSha`, else the first 7 characters) in muted monospace, the title on one
  line, then "and N more commits" when `total` exceeds the list. Authors of kind `bot` or `ai` have a rounded-square
  avatar with a chip or sparkles glyph and the role badge; a person without an avatar URL shows the
  login's initials. A floating "Comment" pill beside the linked-chat button opens a composer sheet
  that writes a top-level comment, and "Show more discussion" at the end loads older entries.
  Without `forge.conversation@1` the screen keeps the activity list, newest first, with "Show
  more activity" at the end.
- Direct media: the conversation mounts a `DirectImageSourcesProvider` (`rendering/**`, forge
  independent) built from the page. A Markdown or HTML image whose `src` equals a `media[].source`,
  or an avatar marked `avatarDirect`, loads from its `url` without any header and is stored in the
  shared attachment disk cache under the connection scope and the stable `source`, never the URL;
  once cached, expiry is irrelevant. An uncached image whose URL has expired (by the phone clock,
  or a 4xx answer) re-reads the conversation query once (joining a read already in flight, and
  reusing a URL another image already refreshed) and tries the fresh URL once; a second failure, a
  server error or a failed refresh shows the image's failure placeholder without a retry loop.
  Every other image keeps the companion media path. The chat does not mount the provider and is
  unchanged.

## What a new plugin (Arcanum) implements

- Declare `forge.conversation@1` (and `forge.comments@1` for writes) and, if comment images or
  avatars can be handed out credential-free, the media hosts in `initialize`.
- `forge.pullRequest.conversation`: entries newest first across pages with an opaque cursor
  (the first page holds the newest entries, `nextCursor` continues to older ones; a thread is
  placed by its first comment, and its own `comments` stay oldest first);
  every `Author` with its `kind` (`bot` for robots, `ai` for AI reviewers); comment remarks as
  `reviewThread` entries with `resolution: { kind: "issue", state, changedBy, changedAt }`, plain
  discussions as `{ kind: "conversation", resolved }` and unresolvable ones as `{ kind: "none" }`;
  the anchor (`line` with `startLine` strictly before `line`, `file`, or `pullRequest` for a
  general remark); `iteration` with the forge's id and its positive number; `reviewId` when the
  remark was published with a review entry; `openIssuesBlockMerge` from the merge rule (the same
  value on every page; `null` if unknown); verdicts including `mergeBlocked`, `mergeUnblocked` and
  `approvalWithdrawn`; events with their `category` (an iteration upload is `push`).
- `forge.media.read` for forge-hosted images, refusing foreign hosts with `-32602`.
- `forge.pullRequest.comment.create` / `forge.pullRequest.reviewThread.reply` accept the thread id
  of an issue too; issue state changes are not part of this contract.
- **Code excerpt (`ReviewThread.excerpt`, optional).** From the diff and the remark's anchor data:
  for a remark on lines of a file, up to 8 diff lines of the iteration's diff that end at the
  remark's last line, each `context` (both numbers), `added` (new-side number) or `removed`
  (old-side number), text cut to 400 characters, one line each. The last line must exist on the
  anchor's `side` with the anchor's `line`; if the remark's numbering cannot be matched to the diff
  (for example it was written on an older iteration whose diff is unavailable), omit the excerpt.
  A remark that is now a `file` anchor may carry the excerpt from the iteration it was written on,
  numbered as there. A general remark (`pullRequest` anchor) has none. Breaking a rule drops only
  the excerpt.
- **Resolve conversations (`forge.conversation.resolve@1`, optional).** Declare it only if
  Arcanum can resolve and reopen plain discussion threads (threads mapped to
  `{ kind: "conversation" }`). Then send `viewerCanToggle: true` on those threads the viewer may
  resolve (while unresolved) or reopen (while resolved), and implement
  `forge.pullRequest.reviewThread.resolve`: `{ account, ref, threadId, resolved, idempotencyKey }`
  → `{ resolved, viewerCanToggle }`; a thread already in that state answers it without writing; a
  thread of another pull request or an unknown one answers `-32115`; an issue thread, a `none`
  thread or a forbidden change answers `-32113` with the reason. Issue states (open, resolved,
  dropped) are not changed through this method. Without the capability, the client shows no
  Resolve button; nothing else changes.
- **Push commits (`event.commits`, optional).** For a `push` event (an iteration upload or a push to
  the review branch): `{ total, items }` with the iteration's commits oldest first, the first 20 of
  them in `items` and all of them counted in `total`; each `{ sha, shortSha | null, title,
  authorLogin | null }` with `sha` 1..64 ASCII letters and digits (`shortSha` 1..16), `title` the
  first line of the message (at most 256 characters, no control characters), `authorLogin` the
  author's login when known. Omit `commits` when the iteration's commits are unknown. Breaking a
  rule drops only the list; the event keeps its text. Arcanum `ci` events may stay without an
  outcome: the contract has none yet.
- `forge.pullRequest.activity` (still required by `forge.read@1`): items newest first by
  `createdAt` within a page; the first page holds the newest and `nextCursor` continues to older
  items (a review-thread reply may stay on the page of its thread's first comment).
- `codewide-companion forge plugin check` checks the page shape plus the rules serde cannot
  express (at least one comment, valid lines, positive iteration number, excerpt and push commit
  rules, conversation entries newest first on the first two pages, activity items newest first on
  the first page, thread comments oldest first, RFC 3339 `createdAt`); with `--write-probes` it
  sends a reply and a resolution to a thread that cannot exist and requires both to be refused.
