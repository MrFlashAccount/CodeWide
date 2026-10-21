import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";

import { reviewResources } from "../data/forgeRuntime";
import { threadId as validThreadId } from "../data/reviewContract";
import { decodeOrNull } from "../data/forgeWire";
import type { CodeReviewGuideBinding } from "../features/review/workspace/CodeReviewGuide";
import { reviewDiffSource } from "../features/review/workspace/reviewDiffSource";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";

/**
 * Guide binding of a thread's Changes review. The owning thread writes the
 * guide (session sources and the thread whose VCS review is open); a recorded
 * turn reviews that turn. An invalid thread id yields no guide.
 */
export function reviewGuideBinding(request: {
  readonly connectionId: string;
  readonly cwd: string;
  readonly thread: Thread | null;
  readonly threadId: string;
  readonly turnId: string | null;
}): CodeReviewGuideBinding | undefined {
  const owner = decodeOrNull(() => validThreadId(request.threadId, "threadId"));
  if (owner === null) {
    return undefined;
  }
  const title = request.thread?.name ?? "This thread";
  return {
    author: { kind: "thread", threadId: owner },
    authorLabel: title,
    capabilities: workspaceFeatures.reviewTarget,
    connectionId: request.connectionId,
    describeThread: (threadId) => (threadId === owner ? title : "Another thread"),
    resources: reviewResources,
    sourceFor: (scope) =>
      reviewDiffSource(scope, { cwd: request.cwd, threadId: owner, turnId: request.turnId }),
  };
}
