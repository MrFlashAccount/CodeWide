import { randomUUID } from "expo-crypto";
import { useState } from "react";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { classifyForgeError } from "../../../data/forgeErrors";
import type { SubmitOutcome } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { createIdempotencyKeys } from "../actions/idempotencyKeys";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
} from "../workspaceCapabilities";
import { submittableDraftIds } from "./dockCounts";
import type { SubmitResult } from "./ReviewOutcome";

const SUBMIT_INTENT = "submit";

/** Dock outcome of an acknowledged Submit; nothing published at all is a failure. */
function submitResult(outcome: SubmitOutcome, verdict: string, draftCount: number): SubmitResult {
  const published = outcome.drafts.filter((draft) => draft.pr === "published").length;
  if (published === 0 && outcome.drafts.length > 0) {
    return {
      kind: "failed",
      reason: outcome.drafts.find((draft) => draft.error !== null)?.error ?? "Not sent",
      verdict,
    };
  }
  return {
    kind: "published",
    left: draftCount - published,
    published,
    reviewUrl: outcome.reviewUrl,
    toAgent: outcome.drafts.filter((draft) => draft.agent === "sent").length,
    verdict,
  };
}

/**
 * Submit review with acknowledged per-draft results. Only a transport failure
 * keeps the idempotency key, so a retry cannot publish twice; every companion
 * answer retires it. A moved head or an unknown outcome asks the screen to
 * refresh before the next attempt. The returned Promise never rejects: its
 * outcome is the dock result.
 */
export function useSubmitReview({
  capabilities,
  drafts,
  onStale,
  target,
}: {
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly drafts: readonly DraftComment[];
  /** The head moved, or the earlier attempt's outcome is unknown: show it and refresh. */
  readonly onStale: (kind: "outcomeUnknown" | "stale") => void;
  readonly target: PullRequestTarget;
}): {
  readonly result: SubmitResult | null;
  readonly submit: (
    verdict: ActionDescriptor,
    body: string | null,
    forwardBothToAgent: boolean,
  ) => Promise<void>;
} {
  const keys = useConstant(() => createIdempotencyKeys(randomUUID));
  const [result, setResult] = useState<SubmitResult | null>(null);
  const fail = useEvent((verdict: ActionDescriptor, error: unknown): void => {
    const failure = classifyForgeError(error);
    keys.settle(SUBMIT_INTENT, failure);
    if (failure.kind === "staleHead" || failure.kind === "outcomeUnknown") {
      onStale(failure.kind === "staleHead" ? "stale" : "outcomeUnknown");
    }
    setResult({
      kind: "failed",
      reason: failure.message,
      verdict: verdict.label,
    });
  });
  const submit = useEvent(
    async (verdict: ActionDescriptor, body: string | null, forwardBothToAgent: boolean) => {
      const idempotencyKey = keys.keyFor(SUBMIT_INTENT);
      try {
        const outcome = await capabilities.submitReview(target, {
          body,
          draftIds: submittableDraftIds(drafts),
          forwardBothToAgent,
          idempotencyKey,
          verdictActionId: verdict.actionId,
        });
        keys.settle(SUBMIT_INTENT, null);
        setResult(submitResult(outcome, verdict.label, drafts.length));
      } catch (error) {
        fail(verdict, error);
      }
    },
  );
  return { result, submit };
}
