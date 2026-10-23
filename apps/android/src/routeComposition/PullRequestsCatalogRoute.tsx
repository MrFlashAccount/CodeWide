import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";

import { forgeResources } from "../data/forgeRuntime";
import type { PullRequestRow } from "../data/forgePullRequestContract";
import { NoServerWelcome } from "../features/threadList/NoServerWelcome";
import { PullRequestsCatalog } from "../features/pullRequests/PullRequestsFeature";
import { PullRequestsHeader } from "../features/pullRequests/PullRequestsHeader";
import { ReviewInboxIllustration } from "../features/pullRequests/onboarding/ReviewInboxIllustration";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useEvent } from "../react/useEvent";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { colors } from "../theme";
import { pullRequestCatalogConnection } from "./pullRequestCatalogConnection";
import { usePullRequestNavigation } from "./pullRequestNavigation";
import { WorkspaceTwoPaneLayout } from "./WorkspaceTwoPaneLayout";

const PREVIEW_PANE_PADDING = 48;

/** Complete `/pulls` destination with no Threads chrome or scene underneath it. */
export function PullRequestsCatalogRoute(): React.JSX.Element {
  const router = useRouter();
  const { desktop, list, viewportWidth } = useWorkspaceRouteResources();
  const navigation = usePullRequestNavigation();
  const connectionId = pullRequestCatalogConnection(list.serverScope, list.servers);
  const openPairing = useEvent((): void => {
    router.push("/settings/servers/new");
  });
  const openPullRequest = useEvent((row: PullRequestRow): void => {
    if (connectionId !== null) {
      navigation.openPullRequest(connectionId, row.pullRequest);
    }
  });
  return (
    <WorkspaceTwoPaneLayout
      catalog={
        <>
          <PullRequestsHeader />
          <PullRequestsCatalogContent
            connectionId={connectionId}
            onOpenPullRequest={openPullRequest}
            onPair={openPairing}
            openingKey={navigation.openingKey}
          />
        </>
      }
      catalogStyle={styles.catalogSurface}
      catalogViewProps={{ testID: "pull-requests-catalog-pane" }}
      detail={desktop && connectionId !== null ? <ReviewInboxIllustration /> : null}
      detailStyle={styles.previewSurface}
      detailViewProps={{ testID: "pull-requests-preview-pane" }}
      presentation={desktop ? { kind: "wide", viewportWidth } : { kind: "catalogOnly" }}
      testID="pull-requests-route"
    />
  );
}

function PullRequestsCatalogContent({
  connectionId,
  onOpenPullRequest,
  onPair,
  openingKey,
}: {
  readonly connectionId: string | null;
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
  readonly onPair: () => void;
  readonly openingKey: string | null;
}): React.JSX.Element {
  return (
    <View style={styles.content} testID="pull-requests-catalog">
      {connectionId === null ? (
        <NoServerWelcome onConnect={onPair} />
      ) : (
        <PullRequestsCatalog
          capabilities={workspaceFeatures.pullRequests}
          connectionId={connectionId}
          forge={forgeResources}
          onOpenPullRequest={onOpenPullRequest}
          openingKey={openingKey}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  catalogSurface: {
    backgroundColor: colors.threadListSurface,
    borderRightColor: colors.borderSoft,
    borderRightWidth: StyleSheet.hairlineWidth,
    flex: 1,
  },
  content: {
    flex: 1,
  },
  previewSurface: {
    alignItems: "center",
    backgroundColor: colors.conversationSurface,
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    padding: PREVIEW_PANE_PADDING,
  },
});
