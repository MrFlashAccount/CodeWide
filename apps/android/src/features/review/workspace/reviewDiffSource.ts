import type { DiffSource, ThreadId } from "../../../data/reviewContract";
import type { ThreadChangeScope } from "../../../data/thread-resource-types";

/**
 * Review target of a thread's change scope: session scopes review the thread's
 * own resources, VCS scopes the workspace. A recorded turn is its own source.
 */
export function reviewDiffSource(
  scope: ThreadChangeScope,
  target: { readonly cwd: string; readonly threadId: ThreadId; readonly turnId: string | null },
): DiffSource {
  if (target.turnId !== null) {
    return { kind: "session", resource: { turnId: target.turnId }, threadId: target.threadId };
  }
  if (scope === "session" || scope === "lastTurn") {
    return { kind: "session", resource: scope, threadId: target.threadId };
  }
  return { kind: "vcs", scope, workspace: target.cwd };
}
