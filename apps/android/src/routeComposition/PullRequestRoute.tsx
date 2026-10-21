import { useLocalSearchParams, useRouter } from "expo-router";
import { Suspense } from "react";
import { StyleSheet, View } from "react-native";

import { parsePullRequestKeyParam } from "../data/forgeContract";
import {
  forgeResources,
  pullRequestCommentDestinations,
  reviewResources,
} from "../data/forgeRuntime";
import { PullRequestScreen } from "../features/pullRequestDetail/PullRequestScreen";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import { colors } from "../theme";
import { RecoverableRenderBoundary } from "../ui/RecoverableRenderBoundary";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { linkedThreadSelectionKey } from "./pullRequestNavigation";
import { useLinkedThreadDescriptions } from "./linkedThreadDescriptions";

/**
 * PR destination. Navigation from the list arrives with the overview already
 * resolved; a cold deep link suspends on the same resource behind a blank
 * local fallback, never a progress label.
 */
export function PullRequestRoute(): React.JSX.Element | null {
  const params = useLocalSearchParams<{ connectionId?: string; pullRequestKey?: string }>();
  const router = useRouter();
  const { desktop, list } = useWorkspaceRouteResources();
  const describeThread = useLinkedThreadDescriptions(list.loadedThreadSummaries);
  const connectionId = typeof params.connectionId === "string" ? params.connectionId : null;
  const pullRequest = parsePullRequestKeyParam(params.pullRequestKey);
  const back = useEvent((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/pulls");
    }
  });
  const openThread = useEvent((threadId: string): void => {
    if (connectionId !== null) {
      list.selectThread(linkedThreadSelectionKey(connectionId, threadId));
    }
  });
  if (connectionId === null || pullRequest === null) {
    return null;
  }
  return (
    <RecoverableRenderBoundary
      label="Pull request"
      resetKey={`${connectionId}:${pullRequest}`}
      scope="surface"
    >
      <Suspense fallback={<View style={styles.fallback} testID="pull-request-loading" />}>
        <PullRequestScreen
          capabilities={workspaceFeatures.pullRequestDetail}
          commentDestinations={pullRequestCommentDestinations}
          connectionId={connectionId}
          describeThread={(threadId) => describeThread(connectionId, threadId)}
          forge={forgeResources}
          navigation={{ back, openThread }}
          pullRequest={pullRequest}
          review={reviewResources}
          reviewCapabilities={workspaceFeatures.reviewTarget}
          tablet={desktop}
        />
      </Suspense>
    </RecoverableRenderBoundary>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
  },
});
