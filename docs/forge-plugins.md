# Forge plugins

Status: **as-built contract of the forge backend, not yet released**. It follows the approved
architecture with its approved implementation deviations: account-scoped forge calls,
`credentialSource` on verified logins, the plugin binary in `crates/forge-github`, the Linux
`--bundled-plugin-dir` flag, `provider.defaultHost`, and a terminal `failed` auth flow state.
This document is the plugin contract for forge providers (GitHub, Arcanum, later GitLab). It is the reference for the
built-in GitHub plugin and for out-of-repository plugins such as Arcanum. The companion side
is owned by [`crates/companion-core/src/forge`](../crates/companion-core/src/forge/CONTEXT.md);
review targets, drafts and guides are owned by
[`crates/companion-core/src/review`](../crates/companion-core/src/review/CONTEXT.md).

The companion owns forge identity, account links, the action journal, PR–thread links and every
client-facing RPC. A plugin owns one forge's HTTP API and that forge's credentials. Android never
talks to a forge or a plugin, never parses a plugin result and never branches on a plugin or
forge name: it branches on capabilities and action descriptor kinds only.

## Providers

- A **provider** is a registered forge plugin.
- **Built-in providers** are compiled into the companion's provider list and are always present.
  GitHub is built in on Linux and macOS as `bundled:github`. A built-in provider can be disabled,
  never uninstalled; "unregistered GitHub" is not a product state.
- **External providers** come from `<state_directory>/forge-plugins.json` (registry version 1).
  Each entry names an absolute executable, canonicalized at install time, as for VCS providers.
- A disabled provider keeps its account links. Its methods answer a local `-32080` and its
  cards and list sections are hidden. Re-enabling restores it.
- Each provider card of `companion/forge/accounts/read` carries `installation`, re-evaluated on
  every read: `{ state: "installed" }`, `{ state: "missing", reason }` when the registered or
  bundled executable does not exist, or `{ state: "failed", reason }` when it exists but could not
  start, initialize or answer `auth.methods`. A disabled provider is not spawned, so it is
  `installed` whenever its executable exists. The companion logs a missing executable once per
  provider, with the plugin id only. Older clients ignore the field.
- Each account link carries `catalogEnabled` (default `true`). The client switch
  `companion/forge/account/setEnabled` `{ account, enabled }` → `{ account }` excludes or
  re-includes one account in `companion/pullRequests/list` and `search` without calling the
  plugin; the link, its derived state, its credential, direct reads of its pull requests, branch
  detection and PR–thread linking stay.
  A repeated sign-in of the same login keeps the choice.
- Plugins are probed in priority order. For `forge.repository.resolve` the first claim wins and
  is terminal, as in [VCS provider selection](vcs-plugins.md#provider-selection).

### Bundled plugin location

Each host passes its bundled plugin directory in the runtime config. The companion resolves
`bundled:<id>` against that directory at every spawn; no path is inferred from `current_exe` and
no path is stored.

- Linux: `codewide-companion serve --bundled-plugin-dir <dir>`; without the flag the
  companion uses `<install root>/current/libexec`, the running generation's `libexec/` (binary
  `codewide-forge-github`). The systemd unit does not pass the flag, so a rollback to an older
  generation never sees an unknown argument. The host-update managed list includes the binary,
  so a remote host update replaces it. Homebrew passes `#{opt_libexec}`.
- macOS: `CodeWide.app/Contents/Helpers/codewide-forge-github`, a universal helper signed with
  the app identity. A Sparkle update replaces it with the app bundle.
- A missing binary means "provider unavailable" (`-32080`), never a fallback path.
- The binary is built from `crates/forge-github` on both hosts (`cargo build -p forge-github`),
  so the macOS build does not depend on the Linux companion crate.

## Process protocol

The framing and process rules are those of [VCS providers](vcs-plugins.md#process-protocol):

- JSON-RPC 2.0 over stdin/stdout with LSP framing (`Content-Length`), at most 32 MiB per frame;
- protocol version `1`;
- an absolute executable and no shell;
- stderr is discarded by the companion, so a host tool's diagnostics cannot reach companion logs.

The companion currently runs one bounded batch per spawn: `initialize`, then the requests of one
batch, then it closes stdin. A plugin may serve several requests per process. Moving to a
supervised long-lived process (experiment E1: more than 300 ms per refresh) is not a protocol
change.

The one exception is an **auth flow**: a `hostLogin` flow runs in one dedicated plugin process
that lives from `auth.start` until the flow ends. Cancel, the 15-minute expiry or a companion
restart closes that process's stdin; the plugin must then terminate its host child process.

Wire DTOs, capability ids, plugin error codes, framing and the conformance harness live in
`crates/forge-protocol`. Plugin crates depend only on `forge-protocol`, never on
`companion-core`.

### `initialize`

```json
{
  "protocolVersion": 1,
  "client": { "name": "codewide-companion" },
  "capabilities": ["forge.auth@1", "forge.list@1", "forge.read@1"],
  "stateDirectory": "/absolute/plugin/state/directory"
}
```

`stateDirectory` is the plugin's own directory under the companion state directory. The result
contains the same `protocolVersion` plus `provider`, `forgeName` (the display name), `version`
(the plugin build version; logged, and used to prove that a host update replaced the plugin) and
the supported `capabilities`, and optionally the plugin's display identity:

- `defaultHost`: the host a new account starts on, shown while the provider is not started;
- `providerIcon`: the provider's icon, exactly one of

  ```json
  { "kind": "glyph", "viewBox": "0 0 16 16", "path": "M8 0C3.58 0 …z" }
  { "kind": "image", "mimeType": "image/png", "dataBase64": "iVBORw0KGgo…" }
  { "kind": "file", "path": "icons/forge.svg" }
  { "kind": "url", "url": "https://cdn.example/forge.png" }
  ```

  A `glyph` is one monochrome SVG path the client tints. An `image` is standard base64 of
  `image/svg+xml`, `image/png` or `image/webp`, at most 64 KiB decoded. A `file` path is absolute
  or relative to the plugin executable's directory; its extension (`.svg`, `.png`, `.webp`) names
  the type. A `url` must be `https`.

The companion knows no provider's name, host or icon itself, including the bundled GitHub plugin.
It resolves the icon once per distinct declaration (plugin version, name, host and icon source):
a file is read and a URL is fetched by the companion, never by a client, and every source becomes
an inline `glyph` or `image`, or `null` (see [Safety rules](#safety-rules)). The resolved identity
is stored, so a disabled or not yet started provider still shows what it last declared; a provider
that never initialized shows its plugin id and no icon. An unknown or malformed `providerIcon` is no
icon and does not fail `initialize`; the conformance harness reports it. Older companions ignore
`defaultHost` and `providerIcon` and require the earlier `icon: { iconKey, glyph }` object, so a
plugin that must also run under them sends that object as well; this companion ignores it.

With `forge.conversation@1` the result may also carry `mediaHosts: string[]`: exact lowercase
hosts, other than its accounts' hosts and their subdomains, whose media `forge.media.read` serves
(the GitHub plugin declares the `*.githubusercontent.com` image hosts). It is optional and omitted
when empty. The same hosts bound the direct URLs a conversation page may hand to a client
(`Comment.media[].url`, `Author.avatarDirect`); see [forge-conversation.md](forge-conversation.md).

The result may also carry `webHosts: string[]`: exact lowercase hosts, other than its accounts'
hosts, that serve the forge's web pages (Arcanum answers its API on `arcanum.yandex.net` and its
pages on `a.yandex-team.ru`). It is optional and omitted when empty. A pull request's `webUrl`,
a comment `url`, a review's `reviewUrl` and an action's `openUrl` reach a client only as `https`
on the account host or one of these; anything else is dropped.

## Capabilities

Required: `forge.auth@1`, `forge.list@1`, `forge.read@1`, `forge.diff@1`, `forge.actions@1`,
`forge.review@1`.

Optional: `forge.search@1`, `forge.checks@1`, `forge.viewed@1`, `forge.resolve@1`,
`forge.scenarioContext@1`, `forge.conversation@1`, `forge.comments@1`,
`forge.conversation.resolve@1` (these three are specified in
[Pull request conversation](forge-conversation.md); `forge.conversation.resolve@1` resolves review
conversations and is unrelated to `forge.resolve@1`), `forge.fileContent@1` (see
[Whole-file content](#whole-file-content)).

- Without `forge.search@1`, the provider remains available through `forge.list@1`. The companion
  projects a legacy-compatible query (category, zero or one repository, open state and default
  sort) to that method; any richer query selecting the provider fails instead of silently ignoring
  filters.
- Without `forge.checks@1`, or without its checks credential, checks show as `unavailable` with
  a reason; every other capability keeps working.
- Without `forge.viewed@1`, viewed marks are stored only on the companion and labelled
  "Viewed · this companion".
- Without `forge.resolve@1`, the provider takes no part in branch detection; manual links still
  work.
- Without `forge.fileContent@1`, Changes shows only the recorded patch hunks of each file.
- Without `forge.conversation.resolve@1`, review conversations are read-only: no Resolve or
  Unresolve button is shown.
- A call for an undeclared capability answers `-32080` without spawning the plugin.

## Methods

Plugins never see the companion's `PullRequestKey`. They use `ForgePrRef = { host, repository,
number }`, and the companion issues keys. Every `forge.*` method except
`forge.repository.resolve` takes `account: { host, login }` (`ForgeAccountRef`); the `auth.*`
methods name `host` and `login` directly. `forge.repository.resolve` runs before any account is
known and takes only the remotes.

| Method | Capability | Params → result |
|---|---|---|
| `auth.methods` | `forge.auth@1` | `{ host \| null }` (`null` asks for the plugin's default host) → `{ methods: AuthMethod[], defaultHost }` |
| `auth.start` | `forge.auth@1` | `{ methodId, host, login \| null, token \| null }` → `{ kind: "hostLogin", userCode, verificationUri, expiresInSeconds }` or `{ kind: "linked", login, scopes \| null, credentialSource \| null }` |
| `auth.poll` | `forge.auth@1` | `{}` on the flow's own process → `{ state: "pending" }`, `{ state: "complete", login }` or `{ state: "failed", reason, fallbackInstructions, retryable }` (`retryable` defaults to `true`) |
| `auth.verify` | `forge.auth@1` | `{ host, login, purpose }` → `{ login, credentialSource \| null, scopes \| null }` or `-32110` |
| `auth.disconnect` | `forge.auth@1` | `{ host, login, mode: "logoutHost" \| "forgetToken" }` → `{}`; only modes the method declares in `disconnectModes` |
| `forge.pullRequests.list` | `forge.list@1` | `{ account, category, repository \| null, cursor \| null, limit ≤ 50 }` → `{ supportedCategories, rows, nextCursor }`; `involved` means the account authored, was assigned, was mentioned, reviewed, or participated in the pull request; rows carry `ref`, may carry `activityRevision`, and omit `pullRequest`, `account`, `localCheckout` and `linkedThreadCount` |
| `forge.pullRequests.search` | `forge.search@1` | `{ account, query, cursor \| null, limit ≤ 50 }` → the same page shape; `query` has text, quick-view category, include/exclude sets for repositories, people, review, state, checks, labels and branches, plus sort; values within one field are ORed and different fields are ANDed |
| `forge.pullRequests.byBranch` | `forge.resolve@1` | `{ account, repository, branch }` → `{ refs: ForgePrRef[] }`, open PRs only |
| `forge.repository.resolve` | `forge.resolve@1` | `{ remotes: string[] }` → `{ host, repository }` or `-32004` |
| `forge.pullRequest.read` | `forge.read@1` | `{ account, ref }` → overview fields except `links`, `localCheckout` and `catalog`; `activityRevision`, `checks`, `checkItems` and `activity` are optional, and `forge.checks@1` results take precedence |
| `forge.pullRequest.activity` | `forge.read@1` | `{ account, ref, cursor }` → `ActivityPage`: items newest first by `createdAt` within a page; the first page (also the `activity` of `forge.pullRequest.read`) holds the newest, `nextCursor` continues to older items (a review-thread reply may stay on the page of its thread's first comment) |
| `forge.pullRequest.checks` | `forge.checks@1` | `{ account, ref, headRevision }` → `{ summary: CheckSummary, items: CheckItem[] }` |
| `forge.pullRequest.files` | `forge.diff@1` | `{ account, ref, headRevision, cursor \| null }` → `{ headRevision, files, truncated, nextCursor }`; a file's `patch` is `{ state: "present", text }`, `tooLarge`, `binary` or `notProvided` (the companion adds hunks), and `viewed: boolean \| null` |
| `forge.pullRequest.actions` | `forge.actions@1` | `{ account, ref }` → `ActionCatalog` |
| `forge.pullRequest.action.run` | `forge.actions@1` | `{ account, ref, actionId, headRevision, input, idempotencyKey }` → `{ message \| null, openUrl? }` |
| `forge.pullRequest.review.submit` | `forge.review@1` | `{ account, ref, headRevision, verdictActionId, body \| null, comments: { draftId, path, side, startLine, endLine, body }[], idempotencyKey }` → `{ reviewUrl \| null, comments: { draftId, state: "published" \| "failed" \| "outdated", error \| null }[] }` |
| `forge.pullRequest.viewed.set` | `forge.viewed@1` | `{ account, ref, headRevision, path, viewed }` → `{}` |
| `forge.pullRequest.conversation` | `forge.conversation@1` | `{ account, ref, cursor \| null }` → `ConversationPage` (see [forge-conversation.md](forge-conversation.md)); comments may carry credential-free direct image URLs in `media`, which the companion keeps only on declared `mediaHosts` |
| `forge.media.read` | `forge.conversation@1` | `{ account, url }` → `{ contentType, bytesBase64 }`, at most 10 MiB; a URL outside the account's forge and media hosts, or a redirect there, answers `-32602`; larger media answer `-32113` with `data.kind = "tooLarge"` |
| `forge.pullRequest.comment.create` | `forge.comments@1` | `{ account, ref, body, idempotencyKey }` → `{ comment }` |
| `forge.pullRequest.reviewThread.reply` | `forge.comments@1` | `{ account, ref, threadId, body, idempotencyKey }` → `{ comment }`; a thread of another pull request answers `-32115` |
| `forge.pullRequest.reviewThread.resolve` | `forge.conversation.resolve@1` | `{ account, ref, threadId, resolved, idempotencyKey }` → `{ resolved, viewerCanToggle }`; a thread of another pull request answers `-32115`, a thread that is not a conversation or a change the viewer may not make `-32113` |
| `forge.pullRequest.fileContent` | `forge.fileContent@1` | `{ account, ref, headRevision, path }` → `{ state: "text", content }`, `{ state: "tooLarge", bytes \| null }`, `{ state: "binary" }` or `{ state: "missing" }`; see [Whole-file content](#whole-file-content) |
| `forge.pullRequest.scenarioContext` | `forge.scenarioContext@1` | `{ account, ref, scenario, checkId \| null }` → `{ conflicts, failingChecks: { checkId, name, logExcerpt }[], comments: { author, path \| null, line \| null, body }[] }`, at most 64 KiB |

The shared shapes (`AuthMethod`, `CheckSummary`, `CheckItem`, `ActivityPage`, `ActionCatalog`,
`ActionDescriptor`, overview and file fields) are defined once in `crates/forge-protocol`; the
companion re-validates every result before it becomes a project type.

- `HeadRevision` is opaque: the head SHA on GitHub, the diff-set id on Arcanum.
- `activityRevision` is the same opaque provider witness on a list row and its overview. It changes when user-relevant PR activity changes. The companion hashes it before storage or client projection. Older plugins may omit it; the companion then falls back to the list row's `updatedAt`, or the head revision on a cold deep link.
- `review.submit` reports per-comment results. A forge that publishes a review atomically
  (GitHub) reports all comments with one state; a forge that cannot must report partial
  publication explicitly. The companion never assumes all or nothing.
- File pages hold at most 100 files. A patch above 4 MiB, or any forge-side too-large flag,
  becomes `patchState: "tooLarge"`; forge file limits (GitHub: 300 and 3 000 files) become
  `truncated { shown, total }`.

### Whole-file content

`forge.fileContent@1` lets a client show a changed file whole, with its changes inline, instead of
only the recorded patch hunks. `forge.pullRequest.fileContent` reads one file of the head side:

```json
{"account": {"host": "github.com", "login": "octocat"},
 "ref": {"host": "github.com", "repository": "octo/repo", "number": "7"},
 "headRevision": "<the overview's headRevision>",
 "path": "src/lib.rs"}
```

and answers exactly one of:

```json
{"state": "text", "content": "<the complete file>"}
{"state": "tooLarge", "bytes": 5000000}
{"state": "binary"}
{"state": "missing"}
```

- `headRevision` is the opaque head revision of `forge.pullRequest.read` (the head SHA on GitHub,
  the diff-set id on Arcanum). Content at a revision never changes, so a plugin need not check that
  it is still the head; a plugin that can no longer read an older revision may answer `-32112`.
- `path` is the file's head-side path: repository-relative, `/`-separated, at most 4 096 bytes, no
  control characters, and no empty, `.` or `..` segment. Any other path answers `-32602` before
  the forge is contacted.
- `text` is the whole file, valid UTF-8 without NUL, at most 1 MiB (1 048 576 bytes). A larger
  file is `tooLarge` (`bytes` is its size when known, else `null`) and should not be downloaded in
  full; NUL or invalid UTF-8 is `binary`. `forge_protocol::FileContent::classify` applies these
  rules to a file's bytes.
- `missing`: the head has no file at this path (it was removed, or the path is a directory or a
  submodule). A plugin answers `missing`, not an error, for a path that does not exist.
- Line endings are returned as stored; the client aligns the content with the file's patch and
  keeps the patch-only view when they do not match.

The companion serves it to clients as `companion/pullRequest/fileContent/read`
`{ pullRequest, headRevision, path }` → the same four states, after re-applying the size and text
rules. A provider whose last `initialize` did not declare `forge.fileContent@1` is refused with
`-32080` without a plugin spawn. Nothing is cached in the companion; Android keys its query by
connection, pull request, head revision and path, reads it only for a provider that declares the
capability, keeps the patch-only diff while it loads, and keeps it for every state but `text`.

### Action descriptors

A plugin declares PR actions as `ActionDescriptor`s for one `headRevision`. Known kinds are
`verdict`, `merge`, `autoMerge`, `updateBranch`, `close`; the companion adds its own scenario
kinds (`fixCi`, `rebase`, `addressComments`, `reviewPr`) under `codewide.scenario.<kind>`. Any
other kind is treated as `extension`.

Validation, applied by the companion before Android sees the catalog:

- `confirm` other than `none`, `confirm` or `destructive` → the descriptor is dropped;
- `input` of another type → dropped;
- `availability: disabled` without a reason → dropped;
- unknown `placement` → `overflow`; unknown `anchor` kind → no anchor (overflow);
- within a `group`, the first `isDefault` in `order` wins; none → the first by `order`.

Dropped descriptors are logged by their opaque `actionId` only.

Scenario actions belong to the companion. A plugin descriptor whose `actionId` starts with
`codewide.scenario.` or whose kind is a scenario kind is dropped, so no plugin can attach an agent
scenario to a target the companion did not judge. The companion derives `fixCi` from the checks:

- every `failed` `CheckItem` gets its own `fixCi` action anchored `{ kind: "checks", checkId }`,
  with a distinct opaque `actionId`; starting it names that `checkId`, and its run state is that
  check's scenario slot;
- `passed`, `skipped`, `pending` and `cancelled` checks never get one: there is nothing for an
  agent to repair, and a cancelled run is re-run rather than fixed. A plugin maps
  `timed_out`, `action_required` and similar problem outcomes to `failed`;
- a `checkId` shared by several items is ambiguous and is never an anchor (a client would show the
  action on every row with that id). When checks are failing but no failed item can be anchored,
  one whole-PR `fixCi` (`codewide.scenario.fixCi`, no anchor) is offered instead.

A plugin must therefore give each `CheckItem` a `checkId` unique within its pull request.

An action the forge accepts only from its own web page answers `openUrl`: the pull request's page
for the person to finish it there, with a `message` saying so. The companion keeps it only as
`https` on the pull request's host (anything else becomes `null`) and Android opens it once the
run succeeds; an older companion omits it.

Kind floors can only raise the plugin's `confirm` level. Both the companion and Android apply
them:

| Kind | Floor |
|---|---|
| `merge`, `close` | `destructive` |
| `autoMerge` (on and off) | `confirm` |
| `updateBranch` | `confirm` |
| `verdict` | plugin level; `destructive` when the plugin marks it |
| `extension` | plugin level |

Verdicts are a plugin-declared group (for example Approve, Request changes, Comment on GitHub;
Arcanum's Block is a destructive verdict). The Submit sheet is their confirmation.

## Authentication and credentials

**A forge token is never returned to the companion or the phone and never stored by the
companion.** No plugin request or response carries a token, with one exception: `auth.start`
for a `pasteToken` method, in the companion → plugin direction only. Every credentialed request
carries only `account: { host, login }`; the plugin resolves the token itself for that call and
keeps it inside its process.

### Auth methods

`auth.methods` returns the methods available on the host now:

| Kind | Meaning |
|---|---|
| `linkExisting` | the host already has a usable login; `existingLogins` lists logins not yet linked; one tap links |
| `hostLogin` | the plugin drives the host tool's login and returns a one-time code and verification URL |
| `pasteToken` | the user pastes a token on the phone; `links` and `requiredPermissions` describe how to create it |
| `instructions` | host steps the user follows on the host, then Check again |

Each method has a `purpose`: `account`, or `checks` for an optional separate checks credential
(Arcanum CI). `disconnectModes` lists what Disconnect may do: `unlink` (companion link only;
the host login stays usable), `forgetToken` (the plugin deletes a saved token), `logoutHost` (the
plugin logs the login out on the host; requires `destructive` confirmation, otherwise `-32089`).

`links` URLs must be `https` on the provider's declared host; the companion drops any other
link, and drops a method that is neither available nor carries an `unavailableReason`.

### Provider default host

`auth.methods` returns `defaultHost`. The companion exposes it on each provider of
`companion/forge/accounts/read` as `defaultHost: string | null`: from `auth.methods` for a running
provider, else the `defaultHost` the provider last declared in `initialize`, else `null`. Android starts
auth with exactly this host and never derives one; while it is `null`, Connect is disabled.

### Auth flow

- At most one active flow per provider and host, each in its own plugin process.
- The companion polls `auth.poll` every 5 s; a flow ends after 15 minutes, and its plugin
  process and host child are terminated.
- Flow outcomes: `linked`, `failed` and `cancelled`. Only `linked` creates an account link.
  `failed` covers a host tool that failed after the code was shown, output that was not
  understood, and code expiry: an expired code arrives as `failed` with a reason (for example
  "The one-time code expired. Start the login again."). There is no separate `expired` wire state.
- Each entry of `flows` in `companion/forge/accounts/read` is either
  `{ state: "awaitingUser", userCode, verificationUri }` or the terminal
  `{ state: "failed", reason, retryable }`, together with `flowId`, `pluginId`, `host`,
  `methodId` and `expiresAt`. A failed flow stays visible, so the phone shows its cause, until
  the user dismisses it with `companion/forge/auth/cancel`, starts again, or 15 minutes pass
  (failed-flow retention). `retryable: false`
  means starting the same method again is not expected to help (for example, the host login was
  denied). `reason` is a short plugin message, never raw host-tool output.
- A start that fails synchronously, before any code is shown, returns `-32083` with the reason.
- Account state is derived, never stored: `connected` after a successful `auth.verify`,
  `expired` after `-32110`, `error` after any other failure. `connecting` is a flow, not an
  account state.

### GitHub plugin

Credential precedence per host and login:

1. a **saved token** the user pasted, stored by the plugin;
2. `GH_TOKEN` from the companion environment, or `GH_ENTERPRISE_TOKEN` for its own enterprise
   host only (never sent to `github.com`);
3. `gh auth token --hostname <host> --user <login>`; `gh` keeps that credential in its own store.

Methods:

- `linkExisting` when `gh auth status` finds logins on the host.
- `hostLogin` when `gh` is installed and at least **2.40.0** (the first release with `--user`;
  confirmed by parser fixtures). The plugin runs `gh auth login --hostname <host> --web` with
  `GH_BROWSER` and `BROWSER` set to a no-op so nothing opens on the host, and answers its
  "press Enter" prompt on the child's stdin. The parser accepts only the one-time-code line and
  an `https://github.com/login/device` URL on the requested host; any other output ends the flow
  as `failed` with the fallback "Run `gh auth login` on the companion host, then tap Check
  again". The parser is fixture-tested against the minimum and the latest tested `gh` versions.
- `pasteToken` when there is no `gh` or the user prefers not to use it. Generate token opens
  `https://github.com/settings/tokens/new?scopes=repo,read:org&description=CodeWide` (classic).
  A secondary link opens `https://github.com/settings/personal-access-tokens/new` for a
  fine-grained token with Pull requests read and write, Contents read, Checks read, Commit
  statuses read and Metadata read; an organization may have to approve it and only selected
  repositories are visible. The plugin validates the token with `GET /user` and, for classic
  tokens, the `X-OAuth-Scopes` header; a classic token without `repo` and `read:org` is rejected
  with the missing scopes named. Only a valid token is saved. An invalid token returns `-32081` with
  `account: null`, because no account exists yet, and a reason naming the problem.
- `instructions` when `gh` is missing or older than the minimum; no automatic install.

Scopes: a `gh` login has `gh`'s default scopes (`repo`, `read:org`, `gist`). CodeWide inherits the
host login's scopes, states them on the card, and never runs `gh auth refresh` to widen them.

Whole-file content (`forge.fileContent@1`): `GET /repos/{owner}/{repo}/contents/{path}?ref=<head
SHA>` on the pull request's base repository, in the raw media type
(`application/vnd.github.raw+json`), with every path segment percent-encoded and the head revision
required to be a full commit SHA. A fork's head commit is readable there through the base
repository's `refs/pull/<n>/head`, so no access to the fork is needed. A body announced or streamed
above 1 MiB is `tooLarge` without reading the rest; 404, and a JSON answer (a directory listing),
are `missing`. It needs the same Contents read permission as the diff.

Disconnect: `unlink` is the default for `gh` and environment credentials; `forgetToken` is
always used for a saved token; `logoutHost` runs `gh auth logout --hostname <host> --user
<login>` only with destructive confirmation, because it also signs out every other host tool
that uses that `gh` login.

### Saved-token store

A plugin that saves pasted tokens keeps them in a secrets directory under its `stateDirectory`:

- the directory has mode `0700`; one file per secret, mode `0600`;
- writes are atomic: a temporary file, then rename;
- the companion never reads that directory;
- `forgetToken` deletes the file before the companion deletes the account link.

### Token handling in a plugin

- The token goes to the forge only in the `Authorization` header of HTTPS requests.
- It never appears in a URL, in the argv of a child process, in stdout frames or on stderr.
- Results expose only `credentialSource` (`savedToken`, `environment`, `ghCli` or `arcToken`),
  the login and the scopes. A plugin reports the source in `auth.start` (`linked`) and
  `auth.verify`; when it omits it, the companion records `savedToken` for a `pasteToken` link and
  `environment` otherwise.
- A plugin unit test runs every request path with a sentinel token and asserts that no stdout
  frame or stderr line contains it.

Plugins inherit the companion environment, as VCS plugins do, because `gh` and `arc` need `HOME`
and `PATH`. On macOS the LaunchAgent's `PATH` must contain them. Narrowing the environment to an
allowlist is a recorded follow-up.

## Error codes

Plugin errors (`forge-protocol` namespace):

| Code | Meaning |
|---|---|
| `-32004` | not owned (repository not claimed), as for VCS |
| `-32110` | authRequired; the account becomes `expired` |
| `-32111` | capabilityUnavailable |
| `-32112` | staleHead |
| `-32113` | forgeRejected |
| `-32114` | rateLimited |
| `-32115` | notFound |

The companion maps them to its own client range `-32080..-32089`:

- `-32110` → `-32081` (`account` is `null` for a rejected pasted token);
- `-32111` → `-32084`;
- `-32112` with `data.headRevision` → `-32082` with a refreshed catalog; without a head revision
  it becomes `-32083`;
- `-32113` and any unknown plugin code → `-32083 forgeRejected`;
- `-32114` → `-32087` with `data.retryAfterSeconds` when the plugin sent it;
- `-32004` and `-32115` → `-32088 notFound`;
- `-32602` → `-32602`.

A missing binary, a plugin that cannot start or an undeclared capability answers `-32080`; a
plugin timeout or no free process slot is an internal error. Plugin error messages are bounded
and reduced to their code and a short reason before logging; they never contain forge content
or token text.

## Writes and idempotency

Each forge write has exactly one trigger, enforced in the companion:

- review comments and the verdict: only `companion/pullRequest/review/submit`;
- catalog actions: only `companion/pullRequest/action/run`, with confirmation at or above the
  effective level;
- viewed marks: only `companion/pullRequest/viewed/set`;
- a conversation comment: only `companion/pullRequest/comment/create`;
- a review thread reply: only `companion/pullRequest/reviewThread/reply`;
- resolving or unresolving a conversation: only `companion/pullRequest/reviewThread/resolve`.

The three conversation writes publish immediately and carry no `headRevision`; they are journaled
and replayed exactly like a run.

Every run and Submit carries `headRevision`; a plugin must return `-32112` instead of writing
when the head moved. Every write carries an `idempotencyKey`. The companion journals the run
before calling the plugin and returns the stored outcome for a repeated key without calling the
plugin again; a run interrupted by a timeout or restart ends as `outcomeUnknown` and needs a
fresh read and a new key. No agent tool, scenario or refresh constructs an action run, and no
agent path starts an auth flow.

## Limits

Owned by the companion (`forge/limits.rs`):

- plugin call timeout 30 s; `action.run`, `review.submit`, `comment.create`,
  `reviewThread.reply` and `reviewThread.resolve` 60 s;
- at most 4 concurrent plugin processes per companion;
- list and overview reads are cached for 60 s; derived account states are re-verified after
  60 s;
- list pages at most 50 rows per plugin call; file pages at most 100 files;
- one patch at most 4 MiB;
- scenario context at most 64 KiB, bounded by the plugin;
- conversation pages at most 500 entries and cursors at most 4 096 bytes; a comment or reply body
  1..65 536 characters after trimming; `forge.media.read` at most 10 MiB; a focused scenario looks
  its thread up in at most 20 conversation pages;
- `forge.pullRequest.fileContent` text at most 1 MiB, paths at most 4 096 bytes.

## Safety rules

- Plugin results and guide JSON are external DTOs. They pass a validated adapter before becoming
  project types; ids are branded there once.
- Third-party PR text (descriptions, comments, check logs) reaches an agent only as a separate
  fenced input marked untrusted, with its source and authors.
- Provider icons reach clients only as `{ "kind": "glyph", viewBox, path }` or
  `{ "kind": "image", mimeType, dataBase64 }`, or `null`. Each provider card of
  `companion/forge/accounts/read` carries `icon`; `companion/pullRequestLinks/read` names each
  badge's `pluginId` and sends every provider's icon once in `providerIcons`. Clients render
  only this data and never branch on a provider id or name; `null` is a neutral icon.
  - A glyph is accepted only with a `0 0 W H` view box (integer sides 1..1024) and one path of at
    most 4 KiB that starts with a move and holds only SVG path commands, digits, spaces, commas,
    dots and minus signs.
  - Image bytes must be the declared type by content (PNG and WebP signatures, or an SVG document)
    and at most 64 KiB. An SVG must be self-contained: no script, event handler, `foreignObject`,
    `DOCTYPE` or entity, `javascript:`, `@import`, and no `href` or `url(...)` outside the document.
  - A file must be a regular file of an allowed extension within the size cap.
  - A URL must be `https` without credentials; redirects stay `https` (at most 3), the request
    times out after 5 s, the `Content-Type` must be an allowed type matching the content, and the
    body is cut one byte past the cap. The companion fetches it instead of the client so a device
    never contacts a third-party host to draw an icon. A failed fetch shows no icon and is retried
    after 10 minutes; a successful or invalid result is final for that declaration.
  - Anything else is dropped to `null`.
- The GitHub plugin declares the published GitHub mark under GitHub's logo guidelines. The Arcanum
  plugin declares a neutral glyph until an Arcanum asset with confirmed usage terms exists.
- Logs may contain opaque ids only: the `PullRequestKey` hash, `actionId`, `ActionRunId` and
  request ids. Never PR titles or bodies, comment, draft or guide text, remote URLs with
  credentials, tokens, one-time login codes, raw `gh` or `arc` output, or the params of
  `companion/forge/auth/submitToken`.

## Registration

### Linux

```sh
codewide-companion forge provider list
codewide-companion forge provider disable github
codewide-companion forge provider enable github

codewide-companion forge plugin install \
  --id arcanum \
  --executable /absolute/path/to/codewide-forge-arcanum \
  --priority 100
codewide-companion forge plugin list
codewide-companion forge plugin remove arcanum
codewide-companion forge plugin check /absolute/path/to/codewide-forge-arcanum \
  --account <host>/<login> \
  --pull-request <host>/<owner>/<repo>/<number> \
  --remote <remote URL> \
  --write-probes
```

`forge provider` commands talk to the running companion. `forge plugin install`, `list` and
`remove` edit `<state_directory>/forge-plugins.json` (or `--registry <file>`) atomically. Install
also accepts repeated `--arg <value>` for plugin arguments; `--priority` defaults to 50. Built-in
ids cannot be taken by an external plugin, and built-in providers cannot be removed, only
disabled.

Registry format, version 1:

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "arcanum",
      "executable": "/absolute/path/to/codewide-forge-arcanum",
      "args": [],
      "priority": 100
    }
  ]
}
```

The executable must be an absolute path to a file and is canonicalized at install. Plugins are
tried by descending priority, then id. `forge provider disable` is the smallest rollback: the
provider answers `-32080`, its account links and the plugin's secrets stay, and `enable`
restores it.

### macOS

The macOS bundle has no CLI. External plugins are registered in the same `forge-plugins.json`
format (above) in the companion state directory, `~/Library/Application Support/CodeWide/Companion/`.
The LaunchAgent's `PATH` must contain any host tool the plugin needs (`gh`, `arc`); when a tool
is not found, onboarding shows the install or `PATH` instructions. Android has no provider
on/off control: it switches individual accounts only (`companion/forge/account/setEnabled`).
`companion/forge/provider/setEnabled` remains the administrator's rollback, used by the Linux
`forge provider` CLI.

## Conformance

`crates/forge-protocol` has a `conformance` feature: a harness that runs every declared
capability of a plugin executable against recorded fixtures. On Linux it is exposed as
`codewide-companion forge plugin check <executable>`. With `--account`, `--pull-request` and
`--remote` it also exercises account-scoped reads and resolution; `--write-probes` sends write
methods at a deliberately stale head, which a conformant plugin refuses without writing. With
`forge.conversation@1` it reads the first conversation page, checks every thread's rules (at least
one comment, positive lines with `startLine` before `line`, a non-empty anchored path, a positive
iteration number, an `excerpt` within its rules) and of every push event's `commits`, and requires a media read of a foreign host to answer `-32602`; with
`forge.fileContent@1` it reads the first listed file the head still has (text within 1 MiB and
without NUL, or a `tooLarge` size above it), requires a path the head cannot have to answer
`missing` and a path with a `..` segment to answer `-32602`; with `forge.comments@1` and `--write-probes` it requires a reply
to a thread that cannot exist to be refused (a comment create has no safe probe), and with
`forge.conversation.resolve@1` the same for resolving such a thread. An external plugin is documented as
supported only after it passes the harness.

## Arcanum plugin guidance

The Arcanum plugin is built outside this repository, after experiment E2 settles its endpoints
for listing, patches, verdict writes, Block and Sticky semantics and auto-merge (**unknown**
today). The protocol does not change for it.

- Credentials, in order: `ARC_OAUTH_TOKEN` or `ARCANUM_OAUTH_TOKEN`, `~/.arc/token`, then
  `arc token show`.
- Methods: `linkExisting` when that token is found; otherwise `instructions` explaining how to
  obtain the arc OAuth token on the host, with Check again. A token is never typed on the phone.
- Checks credential: a separate `checks` purpose method for the Arc CI token (`ARC_CI_TOKEN`,
  `CI_OAUTH_TOKEN`, `~/.ci/token`). Without it, checks show as `unavailable` and everything else
  works.
- `HeadRevision` is the diff-set id.
- `forge.fileContent@1` (optional): `forge.pullRequest.fileContent` answers the file's content at
  that diff set's head, by the rules in [Whole-file content](#whole-file-content).
- Verdicts are a plugin-declared group; Block is marked `destructive`.
- Partial review publication must be reported per comment.
- `forge.resolve@1`: `forge.repository.resolve` maps the Arc VCS plugin's `arc://arcadia` remote to
  `arcanum.yandex.net` / `arc_vcs` (the repository of Arcanum pull request refs) and answers `-32004`
  for every other remote. `forge.pullRequests.byBranch` answers the open pull requests whose head is
  the `users/<login>/…` server branch; other branches have none.

## VCS dependency

Branch detection uses an additive VCS capability, `vcs.remotes@1` (current branch, upstream and
remote URLs), implemented by the bundled Git plugin and by the external Arc plugin. Detection looks
up the upstream (tracking) branch first, then the local branch when it differs. A VCS provider
without it behaves exactly as before; see [VCS providers](vcs-plugins.md).

## No provider fallbacks in the companion

The companion is provider-neutral. Behaviour specific to one forge or VCS lives in that provider's
plugin and reaches the companion only through declared capabilities. When a plugin lacks a
capability, the companion degrades exactly as for every provider without it: it never runs a
provider's CLI (`arc`, `gh`), branches on a provider id, or relaxes a rule for one provider. A
missing capability is fixed in the plugin.
