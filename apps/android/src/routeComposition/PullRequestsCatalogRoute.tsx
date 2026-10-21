import { StyleSheet, View } from "react-native";

import { forgeResources } from "../data/forgeRuntime";
import { PullRequestsCatalog } from "../features/pullRequests/PullRequestsFeature";
import { workspaceFeatures } from "../features/workspace/createWorkspaceFeatures";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { pullRequestCatalogConnection } from "./pullRequestCatalogConnection";
import { usePullRequestNavigation } from "./pullRequestNavigation";

/** `/pulls` catalog content in the same retained list stack as `/`. */
export function PullRequestsCatalogRoute(): React.JSX.Element | null {
  const { list } = useWorkspaceRouteResources();
  const navigation = usePullRequestNavigation();
  const connectionId = pullRequestCatalogConnection(list.serverScope, list.servers);
  if (connectionId === null) {
    return null;
  }
  return (
    <View style={styles.fill} testID="pull-requests-catalog">
      <PullRequestsCatalog
        capabilities={workspaceFeatures.pullRequests}
        connectionId={connectionId}
        forge={forgeResources}
        onOpenPullRequest={(row) => {
          navigation.openPullRequest(connectionId, row.pullRequest);
        }}
        openingKey={navigation.openingKey}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
