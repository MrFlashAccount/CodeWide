import { requireParsed, type ForgeResources } from "../../data/forgeResources";
import {
  parseActionRun,
  parseScenarioStart,
  parseSubmitOutcome,
  parseViewedSet,
} from "../../data/forgeMutationContract";
import { parseLinks } from "../../data/forgePullRequestContract";
import type { ReviewResources } from "../../data/reviewResources";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";
import type { PullRequestDetailWorkspaceCapabilities } from "./workspaceCapabilities";

/** Binds PR screen mutations and publishes their acknowledged results to the read models. */
export function createPullRequestDetailWorkspaceAdapter({
  forge,
  getSession,
  reportDroppedAction,
  review,
  rpcAfterAttach,
}: {
  readonly forge: Pick<ForgeResources, "files" | "overviews">;
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly reportDroppedAction: (actionId: string) => void;
  readonly review: Pick<ReviewResources, "drafts">;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): PullRequestDetailWorkspaceCapabilities {
  const call = async (connectionId: string, method: string, params: unknown): Promise<unknown> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("The server is not connected");
    }
    return rpcAfterAttach<unknown>(session, method, params);
  };
  return {
    async runAction(target, request) {
      const result = requireParsed(
        parseActionRun(
          await call(target.connectionId, "companion/pullRequest/action/run", {
            actionId: request.actionId,
            confirmation: request.confirmation,
            headRevision: target.headRevision,
            idempotencyKey: request.idempotencyKey,
            input: request.input,
            pullRequest: target.pullRequest,
          }),
          reportDroppedAction,
        ),
        "action result",
      );
      forge.overviews.patch(target, (overview) => ({ ...overview, catalog: result.catalog }));
      // The overview re-read publishes into its own state and never rejects.
      forge.overviews.refresh(target).catch(() => undefined);
      return result;
    },
    async setLink(target, threadId, linked) {
      const links = requireParsed(
        parseLinks(
          await call(target.connectionId, "companion/pullRequest/links/set", {
            linked,
            pullRequest: target.pullRequest,
            threadId,
          }),
        ),
        "links",
      );
      forge.overviews.patch(target, (overview) => ({ ...overview, links }));
      return links;
    },
    async setViewed(target, path, viewed) {
      const mark = requireParsed(
        parseViewedSet(
          await call(target.connectionId, "companion/pullRequest/viewed/set", {
            headRevision: target.headRevision,
            path,
            pullRequest: target.pullRequest,
            viewed,
          }),
        ),
        "viewed mark",
      );
      const current = forge.files.state$[forge.files.keyOf(target)]?.peek();
      if (current?.status === "ready") {
        forge.files.publish(target, {
          ...current.value,
          files: current.value.files.map((file) =>
            file.path === mark.path
              ? { ...file, viewed: { source: mark.source, viewed: mark.viewed } }
              : file,
          ),
        });
      }
      return { source: mark.source, viewed: mark.viewed };
    },
    async startScenario(target, request) {
      return requireParsed(
        parseScenarioStart(
          await call(target.connectionId, "companion/pullRequest/scenario/start", {
            checkId: request.checkId,
            headRevision: target.headRevision,
            idempotencyKey: request.idempotencyKey,
            pullRequest: target.pullRequest,
            scenario: request.scenario,
            target: request.target,
            text: request.text,
          }),
        ),
        "scenario result",
      );
    },
    async submitReview(target, request) {
      try {
        return requireParsed(
          parseSubmitOutcome(
            await call(target.connectionId, "companion/pullRequest/review/submit", {
              body: request.body,
              draftIds: request.draftIds,
              forwardBothToAgent: request.forwardBothToAgent,
              headRevision: target.headRevision,
              idempotencyKey: request.idempotencyKey,
              pullRequest: target.pullRequest,
              verdictActionId: request.verdictActionId,
            }),
          ),
          "submit outcome",
        );
      } finally {
        // Per-draft axes changed on the companion whether the review published or not.
        review.drafts.revalidate({
          connectionId: target.connectionId,
          source: { kind: "pullRequest", pullRequest: target.pullRequest },
        });
      }
    },
  };
}
