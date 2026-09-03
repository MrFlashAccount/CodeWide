import { router } from "expo-router";

import { useEvent } from "../../../react/useEvent";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ReviewLaunchButton } from "../../presentation/review/ReviewLaunchButton";
import type { ReviewScope } from "../../rendering/review/reviewModel";
import { reviewChangesDestination } from "../navigation/routeDestinations";

interface ChangesReviewLaunchButtonProps {
  owner: QualifiedThread;
  scope: ReviewScope;
}

export function ChangesReviewLaunchButton(
  props: ChangesReviewLaunchButtonProps,
): React.JSX.Element {
  const { owner, scope } = props;
  const open = useEvent(() => router.push(reviewChangesDestination(owner, scope)));
  return <ReviewLaunchButton actionId="review-current-changes" onPress={open} />;
}
