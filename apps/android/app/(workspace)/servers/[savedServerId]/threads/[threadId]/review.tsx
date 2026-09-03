import { Redirect, router, Stack, useLocalSearchParams } from "expo-router";

import { ResponseReviewScreen } from "../../../../../../src/v2/features/review/ResponseReviewScreen";
import { ReviewStartScreen } from "../../../../../../src/v2/features/review/ReviewStartScreen";
import { ReviewWorkspaceScreen } from "../../../../../../src/v2/features/review/ReviewWorkspaceScreen";
import { reviewRoute } from "../../../../../../src/v2/features/review/reviewRoute";
import { threadDestination } from "../../../../../../src/v2/features/navigation/routeDestinations";
import { threadId } from "../../../../../../src/v2/domain/ids";
import { qualifiedThread } from "../../../../../../src/v2/domain/qualifiedThread";
import type { ReviewDelivery } from "../../../../../../src/v2/rendering/review/reviewModel";
import { colors } from "../../../../../../src/v2/theme";
import { useEvent } from "../../../../../../src/react/useEvent";

const SCREEN_OPTIONS = {
  animation: "none",
  contentStyle: { backgroundColor: colors.background },
  headerShown: false,
  presentation: "fullScreenModal",
} as const;

export default function ReviewRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/threads/[threadId]/review">();
  const route = reviewRoute(params);
  const close = useEvent(() => router.back());
  const reviewStarted = useEvent((reviewThreadId: string, delivery: ReviewDelivery) => {
    if (route === null || delivery === "inline") {
      router.back();
      return;
    }
    const destination = qualifiedThread(route.owner.savedServerId, threadId(reviewThreadId));
    router.replace(threadDestination(destination));
  });
  if (route === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      {route.mode === "start" ? (
        <ReviewStartScreen onClose={close} onStarted={reviewStarted} owner={route.owner} />
      ) : null}
      {route.mode === "changes" ? (
        <ReviewWorkspaceScreen initialScope={route.scope} onClose={close} owner={route.owner} />
      ) : null}
      {route.mode === "response" ? (
        <ResponseReviewScreen
          itemId={route.itemId}
          onClose={close}
          owner={route.owner}
          turnId={route.turnId}
        />
      ) : null}
    </>
  );
}
