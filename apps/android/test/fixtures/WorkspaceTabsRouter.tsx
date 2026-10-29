import { join } from "node:path";

import { renderRouter } from "expo-router/testing-library";
import { router } from "expo-router/build/imperative-api";
import { Stack } from "expo-router/build/layouts/Stack";
import { Slot } from "expo-router/build/views/Navigator";
import { Pressable, Text, View } from "react-native";

import { WorkspaceCatalogMaster } from "../../src/routeComposition/WorkspaceCatalogMaster";
import { WorkspaceTabsRouteLayout } from "../../src/routeComposition/WorkspaceTabsRouteLayout";

function RootLayout(): React.JSX.Element {
  return <Slot />;
}

function StackLayout(): React.JSX.Element {
  return <Stack screenOptions={{ animation: "none", headerShown: false }} />;
}

function WorkspaceStackLayout(): React.JSX.Element {
  return (
    <Stack screenOptions={{ animation: "none", headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="settings/index" options={{ presentation: "transparentModal" }} />
    </Stack>
  );
}

function ThreadsScreen(): React.JSX.Element {
  return (
    <WorkspaceCatalogMaster mode="threads">
      <View>
        <Text testID="workspace-tabs-threads">Threads</Text>
        <Pressable onPress={() => router.push("/settings")} testID="open-transparent-settings">
          <Text>Settings</Text>
        </Pressable>
      </View>
    </WorkspaceCatalogMaster>
  );
}

function PullRequestsScreen(): React.JSX.Element {
  return (
    <WorkspaceCatalogMaster mode="pullRequests">
      <Text testID="workspace-tabs-pull-requests">Pull requests</Text>
    </WorkspaceCatalogMaster>
  );
}

function ThreadDetail(): React.JSX.Element {
  return <Text testID="workspace-tabs-thread-detail">Thread detail</Text>;
}

function TransparentSettings(): React.JSX.Element {
  return <Text testID="transparent-settings">Settings</Text>;
}

const routeOverrides = {
  _layout: RootLayout,
  "(workspace)/_layout": WorkspaceStackLayout,
  "(workspace)/(tabs)/_layout": {
    default: WorkspaceTabsRouteLayout,
    unstable_settings: { initialRouteName: "(threads)" },
  },
  "(workspace)/(tabs)/(threads)/_layout": {
    default: StackLayout,
    unstable_settings: { anchor: "(lists)", initialRouteName: "(lists)" },
  },
  "(workspace)/(tabs)/(threads)/(lists)/_layout": StackLayout,
  "(workspace)/(tabs)/(threads)/(lists)/index": ThreadsScreen,
  "(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/_layout": StackLayout,
  "(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/index": ThreadDetail,
  "(workspace)/(tabs)/(pull-requests)/_layout": {
    default: StackLayout,
    unstable_settings: { anchor: "pulls/index", initialRouteName: "pulls/index" },
  },
  "(workspace)/(tabs)/(pull-requests)/pulls/index": PullRequestsScreen,
  "(workspace)/settings/index": TransparentSettings,
};

export function renderWorkspaceTabs(initialUrl = "/") {
  return renderRouter(
    { appDir: join(__dirname, "../../app"), overrides: routeOverrides },
    { initialUrl },
  );
}
