import type { V2QueryResult, V2ReviewCapabilities } from "@codewide/sync-client/v2";
import { useState } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { ReviewStartView } from "../../presentation/review/ReviewStartView";
import type {
  ReviewDelivery,
  ReviewStartKind,
  ReviewStartTarget,
} from "../../rendering/review/reviewModel";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";
import { startReview } from "./reviewSubmission";
import { VoiceTextInput } from "../conversation/VoiceTextInput";

interface ReviewStartScreenProps {
  onClose(): void;
  onStarted(reviewThreadId: string, delivery: ReviewDelivery): void;
  owner: QualifiedThread;
}

export function ReviewStartScreen(props: ReviewStartScreenProps): React.JSX.Element {
  const { owner } = props;
  return (
    <V2QueryBoundary
      chrome="none"
      query={{
        cursor: null,
        kind: "thread.resources",
        limit: 100,
        scope: "session",
        threadId: owner.threadId,
      }}
      savedServerId={owner.savedServerId}
      title="review capabilities"
    >
      {(result, _refresh, availability) => (
        <LoadedReviewStart {...props} actionable={availability.actionable} result={result} />
      )}
    </V2QueryBoundary>
  );
}

interface LoadedReviewStartProps extends ReviewStartScreenProps {
  actionable: boolean;
  result: Extract<V2QueryResult, { kind: "thread.resources" }>;
}

function LoadedReviewStart(props: LoadedReviewStartProps): React.JSX.Element {
  const { actionable, onClose, onStarted, owner, result } = props;
  if (result.review.targetKinds.length === 0 || result.review.deliveries.length === 0) {
    return (
      <ResourceStateView
        message="This server does not support starting code review"
        status="error"
      />
    );
  }
  return (
    <ReviewStartController
      key={reviewCapabilitiesKey(result.review)}
      capabilities={result.review}
      actionable={actionable}
      onClose={onClose}
      onStarted={onStarted}
      owner={owner}
    />
  );
}

interface ReviewStartControllerProps extends ReviewStartScreenProps {
  actionable: boolean;
  capabilities: V2ReviewCapabilities;
}

function ReviewStartController(props: ReviewStartControllerProps): React.JSX.Element {
  const { actionable, capabilities, onClose, onStarted, owner } = props;
  const runtime = useV2Runtime();
  const availableKinds = reviewStartKinds(capabilities);
  const [target, setTarget] = useState<ReviewStartTarget>(() =>
    defaultReviewTarget(availableKinds[0]),
  );
  const [delivery, setDelivery] = useState<ReviewDelivery>(() =>
    defaultReviewDelivery(capabilities.deliveries[0]),
  );
  const submit = useEvent(async () => {
    if (!actionable) throw new Error("Wait for the current review capabilities");
    const result = await startReview({ commands: runtime.commands, delivery, owner, target });
    onStarted(result.reviewThreadId, delivery);
  });
  const renderCustomTargetInput = (
    inputProps: Parameters<
      NonNullable<React.ComponentProps<typeof ReviewStartView>["renderCustomTargetInput"]>
    >[0],
  ) => (
    <VoiceTextInput
      {...inputProps}
      audience={owner.savedServerId}
      scope={{ id: `review-start:${owner.threadId}`, kind: "review" }}
      thread={owner}
      value={typeof inputProps.value === "string" ? inputProps.value : ""}
    />
  );
  return (
    <ReviewStartView
      availableKinds={availableKinds}
      disabled={!actionable}
      deliveries={capabilities.deliveries}
      delivery={delivery}
      onClose={onClose}
      onDeliveryChange={setDelivery}
      onSubmit={submit}
      onTargetChange={setTarget}
      // WHY: This is a render prop; repository callback policy delegates its identity to React Compiler instead of stabilizing it with useEvent/useCallback.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      renderCustomTargetInput={renderCustomTargetInput}
      target={target}
    />
  );
}

function reviewStartKinds(capabilities: V2ReviewCapabilities): ReviewStartKind[] {
  return capabilities.targetKinds.map((kind) =>
    kind === "uncommittedChanges" ? "uncommitted" : kind,
  );
}

function defaultReviewTarget(kind: ReviewStartKind | undefined): ReviewStartTarget {
  if (kind === "baseBranch") return { branch: "", kind };
  if (kind === "commit") return { kind, sha: "" };
  if (kind === "custom") return { instructions: "", kind };
  return { kind: "uncommitted" };
}

function defaultReviewDelivery(delivery: ReviewDelivery | undefined): ReviewDelivery {
  return delivery ?? "inline";
}

function reviewCapabilitiesKey(capabilities: V2ReviewCapabilities): string {
  return `${capabilities.targetKinds.join(",")}|${capabilities.deliveries.join(",")}`;
}
