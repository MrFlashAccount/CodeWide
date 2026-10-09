# Agent SDK experiments (not executed)

These scripts settle the open SDK questions named in the architecture canvas.
Each one makes real, paid model calls through the user's `claude` CLI, so each
refuses to run without `--confirm-paid`. None of them has been run as part of
the sidecar implementation; the sidecar ships the documented fallbacks.

| Script | Question | Current sidecar behavior |
|---|---|---|
| `e-steer-uuid.mjs` | Does a fresh `uuid` on a `priority: "now"` steer keep steer semantics? | `STEER_WITH_UUID = true` in `src/threads/session.ts` (single switch; fallback `false`) |
| `e-int-tool.mjs` | Is the process usable after an `aborted_tools` interrupt without `close()`? | the session is released after an interrupt that hit a running command |
| `e-steer-wake.mjs` | What happens to a steer during a wake turn or `/compact`? | steer is accepted into any active turn; `turn.start` during a wake answers `busy` |
| `e-perm-ro.mjs` | Can the `:read-only` profile write through built-in tools or MCP? | `:read-only` = default mode, no setting sources, strict empty MCP config, read tools only, `canUseTool` denies the rest |

Run (from the repo root, after `pnpm --filter @codewide/claude-sidecar build`):

    node apps/claude-sidecar/experiments/<script> --claude /abs/path/to/claude --workspace /abs/scratch/dir --confirm-paid

Each script prints the raw SDK messages as JSON lines to stdout; prompts are
fixed test strings.
