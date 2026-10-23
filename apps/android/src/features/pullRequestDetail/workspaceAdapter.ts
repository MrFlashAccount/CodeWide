import { randomUUID } from "expo-crypto";

import { requireParsed, type ForgeResources } from "../../data/forgeResources";
import {
  parseActionRun,
  parseScenarioStart,
  parseSubmitOutcome,
  parseViewedSet,
} from "../../data/forgeMutationContract";
import { parseLinks } from "../../data/forgePullRequestContract";
import type { ReviewResources } from "../../data/reviewResources";
import type { PullRequestDetailWorkspaceCapabilities } from "./workspaceCapabilities";

/** Binds PR screen mutations and publishes their acknowledged results to the read models. */
export function createPullRequestDetailWorkspaceAdapter({
  forge,
  reportDroppedAction,
  review,
}: {
  readonly forge: Pick<ForgeResources, "files" | "mutations" | "overviews">;
  readonly reportDroppedAction: (actionId: string) => void;
  readonly review: Pick<ReviewResources, "drafts">;
}): PullRequestDetailWorkspaceCapabilities {
  return {
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
      forge.overviews.patch(target, (overview) => ({ ...overview, catalog: result.catalog }));
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
              ? { ...file, viewed: { source: mark.source, viewed: mark.viewed } }
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
  };
}
