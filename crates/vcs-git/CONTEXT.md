# Git VCS provider

## Purpose and owner

The Git implementation of the VCS provider contract in [`docs/vcs-plugins.md`](../../docs/vcs-plugins.md): repository detection, change snapshots per scope (`staged`, `unstaged`, `uncommitted`, `branch`), file diffs, bounded diff pages and `vcs.remotes@1`. The `codewide-vcs-git` plugin executable (`apps/companion-linux/src/bin/codewide-vcs-git.rs`) is its only production consumer and owns the JSON-RPC framing and `workspace.create`. Code owner: backend.

## Module jobs

- `lib.rs` — `GitProvider` (`detect`, `changes`, `diff`, `diff_page`), status, name-status and numstat parsing, synthetic diffs for untracked files and unborn branches, snapshot ids.
- `remotes.rs` — `GitProvider::remotes`: branch, upstream and fetch URLs with credentials removed.
- `tests.rs` — behaviour against real temporary Git repositories.

## Boundary

- Depends on `companion-host` for the VCS value model only. Must not depend on `companion-core` or any forge, agent or provider crate.
- `companion-core` must not run `git`; Git behaviour reaches the companion only through the plugin process.
- Git is the built-in VCS provider `bundled:git`: `companion-core/src/vcs/bundled.rs` maps the id to the `codewide-vcs-git` binary and resolves it against the host's bundled plugin directory at every spawn (Linux `current/libexec`, Homebrew `opt_libexec`). Installers ship the binary in that directory and never register its path; see [Built-in providers](../../docs/vcs-plugins.md#built-in-providers).
