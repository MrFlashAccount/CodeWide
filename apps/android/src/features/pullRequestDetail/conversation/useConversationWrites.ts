import { randomUUID } from "expo-crypto";

import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import { classifyForgeError } from "../../../data/forgeErrors";
import type { OverviewParams } from "../../../data/forgeOverview";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import type { MessageSendResult } from "../../messageContent/messageContent";
import { createIdempotencyKeys } from "../actions/idempotencyKeys";
import { alertOfflineWrite } from "../actions/offlineRefusal";
import type { PullRequestDetailWorkspaceCapabilities } from "../workspaceCapabilities";

/** The two conversation writes, bound to one mounted PR screen. */
export type ConversationWrites = {
  readonly comment: (markdown: string) => Promise<MessageSendResult>;
  readonly reply: (threadId: ReviewThreadId, markdown: string) => Promise<MessageSendResult>;
};

/**
 * Publishes a top-level comment or a thread reply immediately, as on the forge.
 * Offline, the write is refused locally with the shared dialog and nothing is
 * queued. Each intent keeps its idempotency key only across a transport
 * failure; any companion answer, `outcomeUnknown` included, retires it. The
 * intent includes the text, so a retry after editing is a new write with a new
 * key, never a replay of the earlier text's outcome.
 */
export function useConversationWrites({
  capabilities,
  offline,
  params,
}: {
  readonly capabilities: Pick<
    PullRequestDetailWorkspaceCapabilities,
    "createComment" | "replyToReviewThread"
  >;
  readonly offline: boolean;
  readonly params: OverviewParams;
}): ConversationWrites {
  const dialog = useAppDialog();
  const keys = useConstant(() => createIdempotencyKeys(randomUUID));
  const write = async (
    intent: string,
    publish: (idempotencyKey: string) => Promise<unknown>,
  ): Promise<MessageSendResult> => {
    if (offline) {
      alertOfflineWrite(dialog);
      return { status: "refused" };
    }
    try {
      await publish(keys.keyFor(intent));
      keys.settle(intent, null);
      return { status: "sent" };
    } catch (error) {
      const failure = classifyForgeError(error);
      keys.settle(intent, failure);
      return { message: failure.message, status: "failed" };
    }
  };
  const comment = useEvent(async (markdown: string) =>
    write(`comment\u0000${markdown}`, async (idempotencyKey) =>
      capabilities.createComment(params, { body: markdown, idempotencyKey }),
    ),
  );
  const reply = useEvent(async (threadId: ReviewThreadId, markdown: string) =>
    write(`reply:${threadId}\u0000${markdown}`, async (idempotencyKey) =>
      capabilities.replyToReviewThread(params, {
        body: markdown,
        idempotencyKey,
        threadId,
      }),
    ),
  );
  return { comment, reply };
}
