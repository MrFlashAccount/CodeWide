import { randomUUID } from "expo-crypto";

import {
  parseConversationWrite,
  parseThreadResolveWrite,
  type ConversationComment,
  type ConversationPage,
  type ReviewThreadId,
  type ThreadResolveResult,
} from "../../data/forgeConversationContract";
import { requireParsed, type ForgeResources } from "../../data/forgeResources";
import {
  parseActionRun,
  parseAttentionSeen,
  parseReviewChatEnsure,
  parseScenarioStart,
  parseSubmitOutcome,
  parseViewedSet,
  type ReviewChatOpening,
} from "../../data/forgeMutationContract";
import { parseLinks } from "../../data/forgePullRequestContract";
import type { TransferAccess } from "../../data/private-transfer";
import type { ReviewResources } from "../../data/reviewResources";
import type { PullRequestDetailWorkspaceCapabilities } from "./workspaceCapabilities";

const reviewChatRequests = new Map<string, Promise<ReviewChatOpening>>();

async function settleReviewChatRequest(
  key: string,
  request: Promise<ReviewChatOpening>,
): Promise<ReviewChatOpening> {
  return request.finally(() => {
    if (reviewChatRequests.get(key) === request) {
      reviewChatRequests.delete(key);
    }
  });
}

/**
 * Puts an acknowledged top-level comment on top: the loaded pages are newest first and always
 * start at the newest entry. A page that already holds it (a read that raced the write) is kept.
 */
function prependComment(page: ConversationPage, comment: ConversationComment): ConversationPage {
  if (page.entries.some((entry) => entry.kind === "comment" && entry.comment.id === comment.id)) {
    return page;
  }
  return { ...page, entries: [{ comment, kind: "comment" }, ...page.entries] };
}

/** Appends an acknowledged reply to its thread; other entries keep their identity. */
function appendReply(
  page: ConversationPage,
  threadId: ReviewThreadId,
  reply: ConversationComment,
): ConversationPage {
  return {
    ...page,
    entries: page.entries.map((entry) =>
      entry.kind === "reviewThread" && entry.thread.id === threadId
        ? {
            kind: "reviewThread",
            thread: {
              ...entry.thread,
              comments: [...entry.thread.comments, reply],
            },
          }
        : entry,
    ),
  };
}

/** Sets an acknowledged conversation resolution on its thread; other entries keep their identity. */
function setResolution(
  page: ConversationPage,
  threadId: ReviewThreadId,
  result: ThreadResolveResult,
): ConversationPage {
  return {
    ...page,
    entries: page.entries.map((entry) =>
      entry.kind === "reviewThread" && entry.thread.id === threadId
        ? {
            kind: "reviewThread",
            thread: {
              ...entry.thread,
              resolution: {
                kind: "conversation",
                resolved: result.resolved,
                viewerCanToggle: result.viewerCanToggle,
              },
            },
          }
        : entry,
    ),
  };
}

/** Binds PR screen mutations and publishes their acknowledged results to the read models. */
export function createPullRequestDetailWorkspaceAdapter({
  forge,
  reportDroppedAction,
  review,
  transferAccess,
}: {
  readonly forge: Pick<ForgeResources, "conversation" | "files" | "mutations" | "overviews">;
  readonly reportDroppedAction: (actionId: string) => void;
  readonly review: Pick<ReviewResources, "drafts">;
  readonly transferAccess: (connectionId: string, forceRefresh: boolean) => Promise<TransferAccess>;
}): PullRequestDetailWorkspaceCapabilities {
  return {
    async createComment(target, request) {
      const comment = requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/comment/create",
            operationId: request.idempotencyKey,
            params: {
              body: request.body,
              idempotencyKey: request.idempotencyKey,
              pullRequest: target.pullRequest,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseConversationWrite,
        ),
        "comment",
      );
      // Shown at once; the settled mutation also invalidates the page for the forge's own order.
      forge.conversation.patch(target, (page) => prependComment(page, comment));
      return comment;
    },
    async ensureReviewChat(target, workspace) {
      // Concurrent opens with the same choice share one request; another choice is its own.
      const key = [
        target.connectionId,
        target.pullRequest,
        workspace.kind === "path" ? workspace.path : "",
      ].join("\u0000");
      const running = reviewChatRequests.get(key);
      if (running !== undefined) {
        return running;
      }
      const request = forge.mutations
        .execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/chat/ensure",
            operationId: randomUUID(),
            params: { pullRequest: target.pullRequest, workspace },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseReviewChatEnsure,
        )
        .then((result) => requireParsed(result, "review chat"));
      reviewChatRequests.set(key, request);
      return settleReviewChatRequest(key, request);
    },
    async markAttentionSeen(target) {
      requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/attention/seen",
            operationId: randomUUID(),
            params: {
              pullRequest: target.pullRequest,
              revision: target.revision,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseAttentionSeen,
        ),
        "attention marker",
      );
    },
    async replyToReviewThread(target, request) {
      const reply = requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/reviewThread/reply",
            operationId: request.idempotencyKey,
            params: {
              body: request.body,
              idempotencyKey: request.idempotencyKey,
              pullRequest: target.pullRequest,
              threadId: request.threadId,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseConversationWrite,
        ),
        "reply",
      );
      forge.conversation.patch(target, (page) => appendReply(page, request.threadId, reply));
      return reply;
    },
    async resolveReviewThread(target, request) {
      const result = requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/reviewThread/resolve",
            operationId: request.idempotencyKey,
            params: {
              idempotencyKey: request.idempotencyKey,
              pullRequest: target.pullRequest,
              resolved: request.resolved,
              threadId: request.threadId,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseThreadResolveWrite,
        ),
        "resolution",
      );
      // Shown at once; the settled mutation also invalidates the page for the forge's own state.
      forge.conversation.patch(target, (page) => setResolution(page, request.threadId, result));
      return result;
    },
    async runAction(target, request) {
      const result = requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/action/run",
            operationId: request.idempotencyKey,
            params: {
              actionId: request.actionId,
              confirmation: request.confirmation,
              headRevision: target.headRevision,
              idempotencyKey: request.idempotencyKey,
              input: request.input,
              pullRequest: target.pullRequest,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          (value) => parseActionRun(value, reportDroppedAction),
        ),
        "action result",
      );
      forge.overviews.patch(target, (overview) => ({
        ...overview,
        catalog: result.catalog,
      }));
      // The overview re-read publishes into its own state and never rejects.
      forge.overviews.refresh(target).catch(() => undefined);
      return result;
    },
    async setLink(target, threadId, linked) {
      const links = requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/links/set",
            operationId: randomUUID(),
            params: {
              linked,
              pullRequest: target.pullRequest,
              threadId,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseLinks,
        ),
        "links",
      );
      forge.overviews.patch(target, (overview) => ({ ...overview, links }));
      return links;
    },
    async setViewed(target, path, viewed) {
      const mark = requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/viewed/set",
            operationId: randomUUID(),
            params: {
              headRevision: target.headRevision,
              path,
              pullRequest: target.pullRequest,
              viewed,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseViewedSet,
        ),
        "viewed mark",
      );
      const current = forge.files.data(target);
      if (current !== null) {
        forge.files.publish(target, {
          ...current,
          files: current.files.map((file) =>
            file.path === mark.path
              ? {
                  ...file,
                  viewed: { source: mark.source, viewed: mark.viewed },
                }
              : file,
          ),
        });
      }
      return { source: mark.source, viewed: mark.viewed };
    },
    async startScenario(target, request) {
      return requireParsed(
        await forge.mutations.execute(
          {
            connectionId: target.connectionId,
            method: "companion/pullRequest/scenario/start",
            operationId: request.idempotencyKey,
            params: {
              checkId: request.checkId,
              headRevision: target.headRevision,
              idempotencyKey: request.idempotencyKey,
              pullRequest: target.pullRequest,
              // WHY: the companion denies unknown fields, so a whole-PR start keeps the
              // payload an older companion accepts; only a focused start names the thread.
              ...(request.reviewThreadId === null
                ? {}
                : { reviewThreadId: request.reviewThreadId }),
              scenario: request.scenario,
              target: request.target,
              text: request.text,
            },
            scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
          },
          parseScenarioStart,
        ),
        "scenario result",
      );
    },
    async submitReview(target, request) {
      try {
        return requireParsed(
          await forge.mutations.execute(
            {
              connectionId: target.connectionId,
              method: "companion/pullRequest/review/submit",
              operationId: request.idempotencyKey,
              params: {
                body: request.body,
                draftIds: request.draftIds,
                forwardBothToAgent: request.forwardBothToAgent,
                headRevision: target.headRevision,
                idempotencyKey: request.idempotencyKey,
                pullRequest: target.pullRequest,
                verdictActionId: request.verdictActionId,
              },
              scope: `${target.connectionId}:pull-request:${target.pullRequest}`,
            },
            parseSubmitOutcome,
          ),
          "submit outcome",
        );
      } finally {
        // Per-draft axes changed on the companion whether the review published or not.
        review.drafts
          .invalidate({
            connectionId: target.connectionId,
            source: { kind: "pullRequest", pullRequest: target.pullRequest },
          })
          .catch(() => undefined);
      }
    },
    async transferAccess(connectionId, forceRefresh) {
      return transferAccess(connectionId, forceRefresh);
    },
  };
}
