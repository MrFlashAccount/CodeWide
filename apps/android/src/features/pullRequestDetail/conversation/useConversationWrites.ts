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

/** How a resolve or unresolve ended: the forge's resolution, a local refusal or the real failure. */
export type ThreadResolveOutcome =
  | { readonly message: string; readonly status: "failed" }
  | { readonly status: "refused" }
  | { readonly resolved: boolean; readonly status: "settled" };

/** The conversation writes, bound to one mounted PR screen. */
export type ConversationWrites = {
  readonly comment: (markdown: string) => Promise<MessageSendResult>;
  readonly reply: (threadId: ReviewThreadId, markdown: string) => Promise<MessageSendResult>;
  readonly resolve: (threadId: ReviewThreadId, resolved: boolean) => Promise<ThreadResolveOutcome>;
};

/**
 * Publishes a top-level comment, a thread reply or a conversation resolution immediately, as on the forge.
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
    "createComment" | "replyToReviewThread" | "resolveReviewThread"
  >;
  readonly offline: boolean;
  readonly params: OverviewParams;
}): ConversationWrites {
  const dialog = useAppDialog();
  const keys = useConstant(() => createIdempotencyKeys(randomUUID));
  const run = async <Value>(
    intent: string,
    publish: (idempotencyKey: string) => Promise<Value>,
  ): Promise<
    | { readonly message: string; readonly status: "failed" }
    | { readonly status: "refused" }
    | { readonly status: "done"; readonly value: Value }
  > => {
    if (offline) {
      alertOfflineWrite(dialog);
      return { status: "refused" };
    }
    try {
      const value = await publish(keys.keyFor(intent));
      keys.settle(intent, null);
      return { status: "done", value };
    } catch (error) {
      const failure = classifyForgeError(error);
      keys.settle(intent, failure);
      return { message: failure.message, status: "failed" };
    }
  };
  const write = async (
    intent: string,
    publish: (idempotencyKey: string) => Promise<unknown>,
  ): Promise<MessageSendResult> => {
    const outcome = await run(intent, publish);
    return outcome.status === "done" ? { status: "sent" } : outcome;
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
  const resolve = useEvent(
    async (threadId: ReviewThreadId, resolved: boolean): Promise<ThreadResolveOutcome> => {
      const outcome = await run(
        `resolve:${threadId}\u0000${String(resolved)}`,
        async (idempotencyKey) =>
          capabilities.resolveReviewThread(params, { idempotencyKey, resolved, threadId }),
      );
      return outcome.status === "done"
        ? { resolved: outcome.value.resolved, status: "settled" }
        : outcome;
    },
  );
  return { comment, reply, resolve };
}
