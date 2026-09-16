import type {
  ReviewDelivery,
  ReviewStartResponse,
  ReviewTarget,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { ReviewWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts review intents using retained lower authorities. */
export function createReviewWorkspaceAdapter({
  getSession,
  rpcAfterAttach,
}: {
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): ReviewWorkspaceCapabilities {
  const startReview = async (
    connectionId: string,
    threadId: string,
    target: ReviewTarget,
    delivery: ReviewDelivery,
  ): Promise<string> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<ReviewStartResponse>(session, "review/start", {
      delivery,
      target,
      threadId,
    });
    return response.reviewThreadId;
  };
  return { startReview };
}
