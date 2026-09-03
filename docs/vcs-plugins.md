# VCS providers

The companion owns VCS discovery and diff delivery. Android receives
source-neutral `vcs.changes@2`, `vcs.diff@2`, and `vcs.diffPage@1` results and does not execute
Git, Arc, or provider-specific commands.
The application also owns the generic isolated-workspace flow. A provider may
add that option by advertising `workspace.create@1`; the Android client never
executes `git worktree`, `arc-wt`, or another provider command itself.

## Provider selection

1. Enabled external providers run by descending priority.
2. Error `-32004` means “workspace not owned” and permits the next provider.
3. Every other provider error is terminal. In particular, a failing Arc
   provider is never hidden by Git or rollout-history fallback.
4. The bundled Git executable is installed as the lowest-priority provider.
5. Rollout-projected changes are retained only when no VCS provider owns the
   workspace. Attachments always remain rollout-derived.

## Process protocol

Providers are executable processes using JSON-RPC 2.0 on stdin/stdout. Messages
use LSP framing:

```text
Content-Length: <bytes>\r\n
\r\n
<UTF-8 JSON>
```

The current protocol version is `1`. The companion starts a provider for one
bounded operation, sends `initialize`, then the requested VCS method, and
closes stdin. The executable path is absolute and no shell is involved.

### `initialize`

Request parameters:

```json
{
  "protocolVersion": 1,
  "client": { "name": "codewide-companion" },
  "capabilities": ["vcs.changes@2"]
}
```

The result must contain the same `protocolVersion`, the configured provider
id, and every supported method in `capabilities`.

### `vcs.changes`

Request parameters contain one absolute `workspace` path. The result is a
`VcsSnapshot`: repository identity, stable snapshot id, aggregate state and
summary, and absolute file records.

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
codewide-companion vcs changes /absolute/workspace
codewide-companion vcs diff /absolute/workspace /absolute/workspace/file
```

The registry is updated atomically and read for every operation, so installing
or removing a provider does not require restarting the companion.
