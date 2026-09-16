import type { ComposerToolRouteRequest } from "../../services/composer/composerToolRouteSession";
import { useThreadGoalRow } from "../../data/use-workspace-resource-row";
import { GoalFeature } from "../goal/GoalFeature";
import { QueueManagerSheet } from "../queue/QueueFeature";
import { ReviewSheet } from "../review/ReviewTargetSheet";

/** Presents the route-owned queue while queue commands retain one activation Promise. */
export function ComposerQueueRoute({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: Extract<ComposerToolRouteRequest, { readonly kind: "queue" }>;
}): React.JSX.Element {
  return (
    <QueueManagerSheet
      activeTurnId={request.activeTurnId}
      items={request.items}
      onClose={onClose}
      visible
      {...(request.edit === undefined ? {} : { onEdit: request.edit })}
      {...(request.cancel === undefined ? {} : { onCancel: request.cancel })}
      {...(request.move === undefined ? {} : { onMove: request.move })}
      {...(request.steer === undefined ? {} : { onSteer: request.steer })}
    />
  );
}

/** Presents the route-owned goal editor over the retained goal resource. */
export function ComposerGoalRoute({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: Extract<ComposerToolRouteRequest, { readonly kind: "goal" }>;
}): React.JSX.Element {
  const resource = useThreadGoalRow(request.resources, request.goalResourceId);
  return (
    <GoalFeature
      goalResource={resource}
      onClose={onClose}
      visible
      voiceScope={request.voiceScope}
      {...(request.setGoal === undefined ? {} : { onSetGoal: request.setGoal })}
      {...(request.clearGoal === undefined ? {} : { onClearGoal: request.clearGoal })}
    />
  );
}

/** Presents the route-owned review target form and surfaces command rejection locally. */
export function ComposerReviewRoute({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: Extract<ComposerToolRouteRequest, { readonly kind: "review" }>;
}): React.JSX.Element {
  return (
    <ReviewSheet
      onClose={onClose}
      visible
      {...(request.startReview === undefined ? {} : { onStartReview: request.startReview })}
    />
  );
}
