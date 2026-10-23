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

const PREVIEW_PANE_PADDING = 48;

/** Pull requests content projected into the workspace-owned catalog pane. */
export function PullRequestsCatalogPane(): React.JSX.Element {
  const router = useRouter();
  const { list } = useWorkspaceRouteResources();
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
    <View style={styles.catalogSurface} testID="pull-requests-catalog-pane">
      <PullRequestsHeader />
      <PullRequestsCatalogContent
        connectionId={connectionId}
        onOpenPullRequest={openPullRequest}
        onPair={openPairing}
      />
    </View>
  );
}

/** `/pulls` detail content; the workspace shell owns the adjacent catalog and its geometry. */
export function PullRequestsCatalogRoute(): React.JSX.Element | null {
  const { desktop, list } = useWorkspaceRouteResources();
  const connectionId = pullRequestCatalogConnection(list.serverScope, list.servers);
  if (!desktop || connectionId === null) {
    return null;
  }
  return (
    <View style={styles.previewSurface} testID="pull-requests-preview-pane">
      <ReviewInboxIllustration />
    </View>
  );
}

function PullRequestsCatalogContent({
  connectionId,
  onOpenPullRequest,
  onPair,
}: {
  readonly connectionId: string | null;
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
  readonly onPair: () => void;
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
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  catalogSurface: {
    backgroundColor: colors.threadListSurface,
    flex: 1,
    minWidth: 0,
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
