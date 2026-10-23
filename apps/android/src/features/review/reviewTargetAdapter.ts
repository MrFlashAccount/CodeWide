import { randomUUID } from "expo-crypto";

import type { ForgeMutationQueue } from "../../data/forgeMutationQueue";
import { requireParsed } from "../../data/forgeResources";
import { diffSourceKey, type DiffSource } from "../../data/reviewContract";
import { parseDraft, parseSendToAgent } from "../../data/reviewDraftContract";
import { parseGuideRequest } from "../../data/reviewGuideContract";
import type { ReviewResources } from "../../data/reviewResources";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";
import type { ReviewTargetCapabilities } from "./reviewTargetCapabilities";

function reviewScope(connectionId: string, source: DiffSource): string {
  return `${connectionId}:review:${diffSourceKey(source)}`;
}

/** Binds draft and guide mutations to the session authority and the review read model. */
export function createReviewTargetAdapter({
  getSession,
  mutations,
  resources,
  rpcAfterAttach,
}: {
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly mutations: ForgeMutationQueue;
  readonly resources: ReviewResources;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): ReviewTargetCapabilities {
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return rpcAfterAttach<unknown>(session, method, params);
  };
  const refreshDrafts = async (connectionId: string, source: DiffSource): Promise<void> => {
    await resources.drafts.refresh({ connectionId, source });
  };
  const refreshGuide = async (connectionId: string, source: DiffSource): Promise<void> => {
    await resources.guide.refresh({ connectionId, source });
  };
  return {
    async deleteDraft(connectionId, draft) {
      try {
        await call(connectionId, "companion/review/draft/delete", {
          draftId: draft.id,
          expectedVersion: draft.version,
        });
      } finally {
        await refreshDrafts(connectionId, draft.revision.source);
      }
    },
    async putDraft(connectionId, draft, expectedVersion) {
      try {
        return requireParsed(
          await mutations.execute(
            {
              connectionId,
              method: "companion/review/draft/put",
              operationId: randomUUID(),
              params: { draft, expectedVersion },
              scope: reviewScope(connectionId, draft.revision.source),
            },
            parseDraft,
          ),
          "draft",
        );
      } finally {
        await refreshDrafts(connectionId, draft.revision.source);
      }
    },
    async requestGuide(connectionId, request) {
      const idempotencyKey = randomUUID();
      try {
        requireParsed(
          await mutations.execute(
            {
              connectionId,
              method: "companion/review/guide/request",
              operationId: idempotencyKey,
              params: {
                author: request.author,
                idempotencyKey,
                revision: request.revision,
                source: request.source,
              },
              scope: reviewScope(connectionId, request.source),
            },
            parseGuideRequest,
          ),
          "guide request",
        );
      } finally {
        await refreshGuide(connectionId, request.source);
      }
    },
    async sendDraftsToAgent(connectionId, source, draftIds) {
      const idempotencyKey = randomUUID();
      try {
        return requireParsed(
          await mutations.execute(
            {
              connectionId,
              method: "companion/review/draft/sendToAgent",
              operationId: idempotencyKey,
              params: { draftIds, idempotencyKey },
              scope: reviewScope(connectionId, source),
            },
            parseSendToAgent,
          ),
          "send to agent",
        );
      } finally {
        await refreshDrafts(connectionId, source);
      }
    },
    async setStopState(connectionId, request) {
      try {
        await mutations.execute(
          {
            connectionId,
            method: "companion/review/guide/stop/set",
            operationId: randomUUID(),
            params: {
              guideId: request.guideId,
              revision: request.revision,
              source: request.source,
              state: request.state,
              stopId: request.stopId,
            },
            scope: reviewScope(connectionId, request.source),
          },
          () => undefined,
        );
      } finally {
        await refreshGuide(connectionId, request.source);
      }
    },
  };
}
