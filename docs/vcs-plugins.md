# VCS providers

The companion owns VCS discovery and diff delivery. Android receives
source-neutral `vcs.changes@2`, `vcs.diff@2`, and `vcs.diffPage@1` results and does not execute
Git, Arc, or provider-specific commands.
The application also owns the generic isolated-workspace flow. A provider may
add that option by advertising `workspace.create@1`; the Android client never
executes `git worktree`, `arc-wt`, or another provider command itself.

## Provider selection

1. A removed workspace is unsupported before any provider starts. Enabled
   providers are asked to inspect the workspace in descending priority order.
2. A provider advertising `vcs.inspect@1` receives `vcs.inspect` before any
   changes or diff request. It must claim the workspace with its repository
   identity or return `-32004` (“workspace not owned”). Older providers use
   `workspace.inspect` when available, then their existing `vcs.changes`
   ownership response as the final compatibility path.
3. An unavailable executable cannot claim a workspace. Its startup error is
   retained while lower-priority providers are inspected; if none claims the
   workspace, that error is returned. Once a provider claims ownership, every
   operation error is terminal and no other provider is tried.
4. Git is a built-in provider (`bundled:git`), always present at the lowest
   priority; see [Built-in providers](#built-in-providers). Its executable is
   `codewide-vcs-git` (built from `apps/companion-linux`), a protocol shell over the
   `crates/vcs-git` implementation; `companion-core` never runs `git` itself.
5. Rollout-projected changes are retained only when no VCS provider owns the
   workspace. Attachments always remain rollout-derived.

## Built-in providers

The companion declares its built-in providers; the user registry never stores
their executables. Today the only built-in is Git: plugin id `git`, binary
`codewide-vcs-git`. `companion-core` knows only that id-to-binary mapping, not
Git behaviour.

- **Always registered.** A built-in is listed and tried on every operation at
  the lowest priority (`i32::MIN`). At equal priority an external provider
  sorts before a built-in, so a built-in always resolves last.
- **Disable, never remove** (the forge rule). `vcs plugin disable git` records
  `disabledBuiltIns: ["git"]` in `vcs-plugins.json`; `vcs plugin enable git`
  clears it. `vcs plugin remove git` removes only an external override and
  answers `"removed": false` when none exists. Enable and disable address the
  id, so they also set the flag of an external override that shares it.
- **Overrides.** An external plugin may reuse the id `git` with its own
  executable and priority (for example a development build). It stays external
  and is tried before the built-in; when it declines a workspace or cannot
  start, the built-in is tried next. Installing a host-installed copy of the
  bundled binary under the built-in id is refused, since the built-in already
  resolves it.
- **Migration.** Earlier installers registered Git as
  `{"id":"git","executable":"<root>/generations/<generation>/libexec/codewide-vcs-git","priority":-1000}`.
  On every read, an entry with a built-in id whose executable is a
  host-installed copy of that built-in binary (a Linux generation
  `…/generations/*/libexec/<binary>`, a Homebrew keg
  `…/Cellar/<formula>/<version>/libexec/<binary>`, or the binary in the current
  bundled directory) is replaced by the built-in declaration. A disabled legacy
  entry keeps Git disabled. The next registry write persists the migrated
  file; until then the stale entry is ignored. Any other entry is kept.

### Bundled plugin location

The VCS registry uses the same bundled plugin directory as
[forge](forge-plugins.md#bundled-plugin-location). The companion resolves
`bundled:<id>` against that directory at every spawn; no path is inferred from
`current_exe` and no path is stored, so activating another generation changes
the resolved executable without rewriting the registry.

- Linux: `codewide-companion serve --bundled-plugin-dir <dir>`; without the flag
  the companion uses `<install root>/current/libexec`, which follows the
  `current` link to the running generation. `codewide-companion vcs …`
  commands take the same `--bundled-plugin-dir` with the same default. The
  installer copies `codewide-vcs-git` into the generation's `libexec/` and
  registers nothing. Homebrew passes `#{opt_libexec}`.
- macOS: the app passes `CodeWide.app/Contents/Helpers`. The app does not ship
  `codewide-vcs-git` today, so the built-in is listed as unavailable there.
- A missing binary means "provider unavailable": the built-in is skipped and
  never falls back to another path.

## Process protocol

Providers are executable processes using JSON-RPC 2.0 on stdin/stdout. Messages
use LSP framing:

```text
Content-Length: <bytes>\r\n
\r\n
<UTF-8 JSON>
```

The current protocol version is `1`. The companion starts a provider for one
bounded operation, sends `initialize`, then the ownership probe or requested VCS method, and
closes stdin. The executable path is absolute and no shell is involved.

### `initialize`

Request parameters:

```json
{
  "protocolVersion": 1,
  "client": { "name": "codewide-companion" },
  "capabilities": ["vcs.inspect@1", "vcs.changes@2"]
}
```

The result must contain the same `protocolVersion`, the configured provider
id, and every supported method in `capabilities`.

### `vcs.inspect`

An optional capability `vcs.inspect@1` lets a provider decide whether one
absolute workspace belongs to it without collecting changes. The response
contains `capability`, `provider`, and an absolute `repositoryRoot`; a provider
that does not own the folder returns `-32004`. The companion does not infer
ownership from provider names, filesystem markers, or repository layout.

### `vcs.changes`

Request parameters contain one absolute `workspace` path. The result is a
`VcsSnapshot`: repository identity, stable snapshot id, aggregate state and
summary, and absolute file records.

Requests carry one `scope`: `staged`, `unstaged`, `uncommitted` (index and
working tree against `HEAD`, including untracked files), or `branch`. Every
snapshot declares the scopes its provider serves natively in
`availableScopes`; clients offer only those. The companion forwards the
requested scope unchanged to the owning provider and never composes,
synthesizes, or advertises a scope on a provider's behalf, nor branches on a
provider id. A provider rejects a scope it does not serve with an error, which
is terminal for that owned workspace. Paging (`vcs.diffPage`) is likewise
available for a scope only when the provider advertises `vcs.diffPage@1`.

### `vcs.diff`

Request parameters contain an absolute `workspace`, an absolute changed-file
`path`, and the last observed `snapshotId`. The provider returns the current
source-neutral `VcsDiff`: repository and file identity, unified diff, exact
line counts, binary marker, and truncation state. A stale requested snapshot
does not make a current diff unavailable; the returned snapshot id tells the
caller which working-tree state produced the result.

The companion first resolves workspace ownership through `vcs.changes` and
then asks that same provider for `vcs.diff`. Provider errors are terminal and
must never expose a Git or rollout diff for an Arc-owned workspace.

### `vcs.diffPage`

Providers advertise `vcs.diffPage@1` when they can stream a full unified diff
as bounded UTF-8 pages. The request adds byte `offset` and `limit` to the same
workspace, path, snapshot, and scope identity used by `vcs.diff`. The result
contains at most `limit` bytes plus `totalBytes`, `nextOffset`, and a revision
hash of the complete diff. The provider must not materialize the complete diff
to serve one page.

The companion binds each continuation cursor to the authenticated device,
thread, path, scope, and returned revision. It rejects the continuation when
the provider snapshot or full-diff revision changes between pages. Providers
without this capability can still serve the bounded ordinary preview through
`vcs.diff@2`, but cannot serve the explicit full-output action.

### `vcs.remotes`

Providers advertise `vcs.remotes@1` when they can name a workspace's branch and
remotes for forge branch detection and review chat workspace candidates. The
request carries an absolute `workspace`; the result is:

```json
{
  "capability": "vcs.remotes@1",
  "provider": "arc",
  "branch": "PR-1-rebase",
  "upstream": { "remote": "arc", "branch": "users/me/fix" },
  "remotes": [{ "name": "arc", "url": "arc://arcadia" }]
}
```

`branch` is the local branch (`null` on a detached head), `upstream` the
server branch it tracks (`null` when none) under one of the `remotes`, and every
remote URL is stripped of credentials. A forge plugin interprets the URLs through
`forge.repository.resolve`; the companion never parses them. Git answers its
`remote -v` fetch URLs. Arc has no named remotes: its provider answers one
remote `arc` with the URL `arc://<repository>` from `arc info`, and the tracked
server branch as `upstream`. A provider without the capability takes no part in
branch detection or candidate probing; the companion has no fallback for it.

### `workspace.inspect`

This optional method is available only when `initialize.capabilities` contains
`workspace.create@1`. It receives an absolute `workspace` path and either
returns provider identity plus the repository root or rejects the path with
`-32004` (`workspace_not_owned`). The companion exposes this as
`companion/workspace/inspect`; the New Chat selector is hidden when no enabled
provider claims the selected project with this capability.

### `workspace.create`

The companion owns the public mutation and passes the selected provider an
absolute `workspace`, a stable idempotency `requestId`, and an absolute
`storageRoot`. The provider creates an isolated checkout from the current
committed revision and returns its absolute root and effective `cwd`.
Repeating the same request id must resolve the same workspace instead of
creating another checkout.

If the checkout becomes usable before provider-specific preparation finishes,
the provider may emit a JSON-RPC notification before the final response:

```json
{
  "jsonrpc": "2.0",
  "method": "workspace.progress",
  "params": {
    "requestId": "new-chat-123",
    "phase": "preparing",
    "workspace": {
      "capability": "workspace.create@1",
      "provider": "arc",
      "repositoryRoot": "/absolute/worktree",
      "cwd": "/absolute/worktree/project",
      "created": true
    }
  }
}
```

The companion durably checkpoints `creating`, `preparing`, `ready`, or
`failed`. It returns the workspace to the client at `preparing`, allowing the
thread shell and the user's pending message to become visible, but holds the
actual `turn/start` in its durable outbox until the provider's final response
transitions the operation to `ready`. A provider error transitions it to
`failed`; no Codex turn may overlap the post-create hook.

The application must pass that returned `cwd` to `thread/start`. The resulting
`session_meta.cwd` is authoritative for repository detection, Changes, diffs,
terminals, and every other session-scoped path. The source project's path must
not leak into the new session after the workspace has been created.

## CLI

```sh
codewide-companion vcs plugin install \
  --id arc \
  --executable /absolute/path/to/codewide-vcs-arc \
  --priority 100

codewide-companion vcs plugin list
codewide-companion vcs plugin remove arc
codewide-companion vcs plugin disable git
codewide-companion vcs plugin enable git
codewide-companion vcs changes /absolute/workspace
codewide-companion vcs diff /absolute/workspace /absolute/workspace/file
```

The registry is updated atomically and read for every operation, so installing
or removing a provider does not require restarting the companion.
