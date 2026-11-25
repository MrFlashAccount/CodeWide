import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { randomUUID } from "expo-crypto";
import { useState } from "react";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { classifyForgeError } from "../../../data/forgeErrors";
import type { SubmitOutcome } from "../../../data/forgeMutationContract";
import type { DraftComment } from "../../../data/reviewDraftContract";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { usePullRequestFeedback } from "../actions/usePullRequestFeedback";
import { createIdempotencyKeys } from "../actions/idempotencyKeys";
import type {
  PullRequestDetailWorkspaceCapabilities,
  PullRequestTarget,
} from "../workspaceCapabilities";
import { submittableDraftIds } from "./dockCounts";
import type { SubmitResult } from "./ReviewOutcome";

type Submission =
  | { readonly kind: "verdict" }
  | {
      readonly body: string | null;
      readonly draftCount: number;
      readonly forwardBothToAgent: boolean;
      readonly kind: "review";
    };

/** Dock outcome of an acknowledged Submit; nothing published at all is a failure. */
function submitResult(
  outcome: SubmitOutcome,
  verdict: string,
  draftCount: number,
): SubmitResult | { readonly kind: "failed"; readonly reason: string } {
  const published = outcome.drafts.filter((draft) => draft.pr === "published").length;
  if (published === 0 && outcome.drafts.length > 0) {
    return {
      kind: "failed",
      reason: outcome.drafts.find((draft) => draft.error !== null)?.error ?? "Not sent",
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
  /** The head moved, or the earlier attempt's outcome is unknown: refresh the PR. */
  readonly onStale: () => void;
  readonly target: PullRequestTarget;
}): {
  readonly pending: boolean;
  readonly result: SubmitResult | null;
  readonly retry: boolean;
  readonly submit: (
    verdict: ActionDescriptor,
    body: string | null,
    forwardBothToAgent: boolean,
  ) => Promise<void>;
  readonly submitVerdict: (verdict: ActionDescriptor) => Promise<void>;
} {
  const feedback = usePullRequestFeedback();
  const keys = useConstant(() => createIdempotencyKeys(randomUUID));
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [retry, setRetry] = useState(false);
  const sending = useConstant(() => observable(false));
  const pending = useSelector(() => sending.get());
  const fail = useEvent((intent: string, verdict: ActionDescriptor, error: unknown) => {
    const failure = classifyForgeError(error);
    keys.settle(intent, failure);
    if (failure.kind === "staleHead" || failure.kind === "outcomeUnknown") {
      onStale();
    }
    feedback.writeFailure(verdict.label, failure);
    setRetry(true);
  });
  const acknowledge = useEvent(
    (outcome: SubmitOutcome, label: string, submission: Submission): void => {
      if (submission.kind === "verdict") {
        setRetry(false);
        setResult({ kind: "verdict", reviewUrl: outcome.reviewUrl, verdict: label });
        return;
      }
      const review = submitResult(outcome, label, submission.draftCount);
      setRetry(review.kind === "failed");
      if (review.kind === "failed") {
        feedback.error(`${label} failed`, review.reason);
      } else {
        setResult(review);
      }
    },
  );
  const publish = useEvent(async (verdict: ActionDescriptor, submission: Submission) => {
    if (sending.peek() || verdict.availability.state !== "enabled") {
      return;
    }
    const body = submission.kind === "review" ? submission.body : null;
    const draftIds = submission.kind === "review" ? submittableDraftIds(drafts) : [];
    const forwardBothToAgent = submission.kind === "review" && submission.forwardBothToAgent;
    const intent = JSON.stringify([
      target.connectionId,
      target.pullRequest,
      target.headRevision,
      verdict.actionId,
      body,
      draftIds,
      forwardBothToAgent,
    ]);
    sending.set(true);
    try {
      const outcome = await capabilities.submitReview(target, {
        body,
        draftIds,
        forwardBothToAgent,
        idempotencyKey: keys.keyFor(intent),
        verdictActionId: verdict.actionId,
      });
      keys.settle(intent, null);
      acknowledge(outcome, verdict.label, submission);
    } catch (error) {
      fail(intent, verdict, error);
    }
    sending.set(false);
  });
  const submitVerdict = useEvent(async (verdict: ActionDescriptor) =>
    publish(verdict, { kind: "verdict" }),
  );
  const submit = useEvent(
    async (verdict: ActionDescriptor, body: string | null, forwardBothToAgent: boolean) =>
      publish(verdict, { body, draftCount: drafts.length, forwardBothToAgent, kind: "review" }),
  );
  return { pending, result, retry, submit, submitVerdict };
}
