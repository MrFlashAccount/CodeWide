import { randomUUID } from "expo-crypto";

import { requireParsed } from "../../data/forgeResources";
import type { DiffSource } from "../../data/reviewContract";
import { parseDraft, parseSendToAgent } from "../../data/reviewDraftContract";
import { parseGuideRequest } from "../../data/reviewGuideContract";
import type { ReviewResources } from "../../data/reviewResources";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";
import type { ReviewTargetCapabilities } from "./reviewTargetCapabilities";

/** Binds draft and guide mutations to the session authority and the review read model. */
export function createReviewTargetAdapter({
  getSession,
  resources,
  rpcAfterAttach,
}: {
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
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
          parseDraft(
            await call(connectionId, "companion/review/draft/put", { draft, expectedVersion }),
          ),
          "draft",
        );
      } finally {
        await refreshDrafts(connectionId, draft.revision.source);
      }
    },
    async requestGuide(connectionId, request) {
      try {
        requireParsed(
          parseGuideRequest(
            await call(connectionId, "companion/review/guide/request", {
              author: request.author,
              idempotencyKey: randomUUID(),
              revision: request.revision,
              source: request.source,
            }),
          ),
          "guide request",
        );
      } finally {
        await refreshGuide(connectionId, request.source);
      }
    },
    async sendDraftsToAgent(connectionId, source, draftIds) {
      try {
        return requireParsed(
          parseSendToAgent(
            await call(connectionId, "companion/review/draft/sendToAgent", {
              draftIds,
              idempotencyKey: randomUUID(),
            }),
          ),
          "send to agent",
        );
      } finally {
        await refreshDrafts(connectionId, source);
      }
    },
    async setStopState(connectionId, request) {
      try {
        await call(connectionId, "companion/review/guide/stop/set", {
          guideId: request.guideId,
          revision: request.revision,
          state: request.state,
          stopId: request.stopId,
        });
      } finally {
        await refreshGuide(connectionId, request.source);
      }
    },
  };
}
