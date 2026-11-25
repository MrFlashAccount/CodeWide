import { join } from "node:path";

import { renderRouter } from "expo-router/testing-library";
import { Stack } from "expo-router/build/layouts/Stack";
import { useLocalSearchParams } from "expo-router/build/hooks";
import { Slot } from "expo-router/build/views/Navigator";
import { useContext } from "react";
import { Pressable, Text, View } from "react-native";
import { useOpenForgeLink } from "../../src/routeComposition/useOpenForgeLink";
import { SelectedPullRequestContext } from "../../src/features/pullRequests/list/selectedPullRequest";

import SharedPullRequest from "../../app/(workspace)/openpr";
import { AppNoticeProvider } from "../../src/ui/AppNotice";
import V1PullRequestDetailsDestination from "../../app/(workspace)/(tabs)/(pull-requests)/pulls/[connectionId]/[pullRequestKey]/index";
import V1PullRequestChangesDestination from "../../app/(workspace)/(tabs)/(pull-requests)/pulls/[connectionId]/[pullRequestKey]/changes";
import { PullRequestsWorkspaceRouteLayout } from "../../src/routeComposition/PullRequestsWorkspaceRouteLayout";
import { WorkspaceCatalogMaster } from "../../src/routeComposition/WorkspaceCatalogMaster";
import { WorkspaceTabsRouteLayout } from "../../src/routeComposition/WorkspaceTabsRouteLayout";

function RootLayout(): React.JSX.Element {
  return (
    <AppNoticeProvider>
      <Slot />
    </AppNoticeProvider>
  );
}

function StackLayout(): React.JSX.Element {
  return <Stack screenOptions={{ animation: "none", headerShown: false }} />;
}

function ThreadsCatalog(): React.JSX.Element {
  return (
    <WorkspaceCatalogMaster mode="threads">
      <Text testID="production-threads-catalog">Threads catalog</Text>
    </WorkspaceCatalogMaster>
  );
}

function PullRequestsCatalog(): React.JSX.Element {
  const selected = useContext(SelectedPullRequestContext);
  return (
    <Text
      accessibilityState={{ selected: selected === "fpr1.github-91" }}
      testID="production-pull-requests-catalog"
    >
      Pull requests catalog
    </Text>
  );
}

export const linkServer = {
  id: "server",
  enabled: true,
  state: "live",
  displayName: "Fixture server",
  iconId: "desktop",
} as const;
export const prLink = "https://forge.test/octo/repo/7";

function CanonicalThread(): React.JSX.Element {
  const { connectionId, threadId } = useLocalSearchParams<{
    connectionId: string;
    threadId: string;
  }>();
  const open = useOpenForgeLink([linkServer]);
  return (
    <View>
      <Text testID="production-canonical-thread">{`${connectionId}:${threadId}`}</Text>
      <Pressable onPress={() => open(prLink, connectionId)} testID="chat-pr-link">
        <Text>{prLink}</Text>
      </Pressable>
    </View>
  );
}

const routeOverrides = {
  _layout: RootLayout,
  "(workspace)/_layout": StackLayout,
  "(workspace)/openpr": SharedPullRequest,
  "(workspace)/(tabs)/_layout": {
    default: WorkspaceTabsRouteLayout,
    unstable_settings: { initialRouteName: "(threads)" },
  },
  "(workspace)/(tabs)/(threads)/_layout": {
    default: StackLayout,
    unstable_settings: { anchor: "(lists)", initialRouteName: "(lists)" },
  },
  "(workspace)/(tabs)/(threads)/(lists)/_layout": {
    default: StackLayout,
    unstable_settings: { initialRouteName: "index" },
  },
  "(workspace)/(tabs)/(threads)/(lists)/index": ThreadsCatalog,
  "(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/_layout": StackLayout,
  "(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/index": CanonicalThread,
  "(workspace)/(tabs)/(pull-requests)/_layout": {
    default: PullRequestsWorkspaceRouteLayout,
    unstable_settings: { anchor: "pulls/index", initialRouteName: "pulls/index" },
  },
  "(workspace)/(tabs)/(pull-requests)/pulls/index": PullRequestsCatalog,
  "(workspace)/(tabs)/(pull-requests)/pulls/[connectionId]/[pullRequestKey]/index":
    V1PullRequestDetailsDestination,
  "(workspace)/(tabs)/(pull-requests)/pulls/[connectionId]/[pullRequestKey]/changes":
    V1PullRequestChangesDestination,
};

/** Renders the real retained-tabs and Pull request layout chain for interaction regressions. */
export function renderProductionPullRequestRouter(initialUrl = "/pulls/server/fpr1.github-91") {
  return renderRouter(
    { appDir: join(__dirname, "../../app"), overrides: routeOverrides },
    { initialUrl },
  );
}
