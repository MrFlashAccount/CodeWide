import { join } from "node:path";

import { fireEvent, renderRouter, testRouter } from "expo-router/testing-library";
import { router } from "expo-router/build/imperative-api";
import { Stack } from "expo-router/build/layouts/Stack";
import { useLocalSearchParams } from "expo-router/build/hooks";
import { Slot } from "expo-router/build/views/Navigator";
import { Tabs, type BottomTabBarProps } from "expo-router/js-tabs";
import { Pressable, Text, View } from "react-native";

import { WorkspaceTabSceneIsolation } from "../src/routeComposition/WorkspaceTabsRouteLayout";

const mockPrepareLinkedThread = jest.fn();

jest.mock("expo-symbols", () => ({}));

function RootLayout(): React.JSX.Element {
  return <Slot />;
}

function StackLayout(): React.JSX.Element {
  return <Stack screenOptions={{ animation: "none", headerShown: false }} />;
}

function TabsLayout(): React.JSX.Element {
  return (
    <Tabs
      backBehavior="history"
      screenLayout={({ children, navigation, route }) => (
        <WorkspaceTabSceneIsolation
          active={navigation.getState().routes[navigation.getState().index]?.key === route.key}
          routeName={route.name}
        >
          {children}
        </WorkspaceTabSceneIsolation>
      )}
      screenOptions={{ animation: "none", headerShown: false, lazy: false }}
      tabBar={renderTestTabBar}
    >
      <Tabs.Screen name="(threads)" />
      <Tabs.Screen name="(pull-requests)" />
    </Tabs>
  );
}

function renderTestTabBar(props: BottomTabBarProps): React.JSX.Element {
  return (
    <View>
      {props.state.routes.map((route) => (
        <Pressable
          key={route.key}
          onPress={() => {
            const event = props.navigation.emit({
              canPreventDefault: true,
              target: route.key,
              type: "tabPress",
            });
            if (
              route.key !== props.state.routes[props.state.index]?.key &&
              !event.defaultPrevented
            ) {
              props.navigation.navigate(route.name);
            }
          }}
          testID={`tab-${route.name}`}
        >
          <Text>{route.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ThreadsCatalog(): React.JSX.Element {
  return <Text testID="threads-catalog">Threads catalog</Text>;
}

function PullRequestsCatalog(): React.JSX.Element {
  return (
    <View testID="pull-requests-catalog">
      <Pressable onPress={() => router.push("/pulls/server/pr")} testID="open-pull-request">
        <Text>Open pull request</Text>
      </Pressable>
    </View>
  );
}

function PullRequestDetails(): React.JSX.Element {
  const { connectionId, pullRequestKey } = useLocalSearchParams<{
    connectionId: string;
    pullRequestKey: string;
  }>();
  return (
    <View testID="pull-request-details">
      <Text>{`${connectionId}:${pullRequestKey}:overview`}</Text>
      <Pressable onPress={() => router.back()} testID="back-to-pulls">
        <Text>Back</Text>
      </Pressable>
      <Pressable
        onPress={() => router.push(`/pulls/${connectionId}/${pullRequestKey}/changes`)}
        testID="open-changes"
      >
        <Text>Changes</Text>
      </Pressable>
      <Pressable
        onPress={() => {
          mockPrepareLinkedThread(connectionId, "linked-thread");
          router.navigate({
            params: { connectionId, threadId: "linked-thread" },
            pathname: "/threads/[connectionId]/[threadId]",
          });
        }}
        testID="open-linked-thread"
      >
        <Text>Linked thread</Text>
      </Pressable>
    </View>
  );
}

function PullRequestChanges(): React.JSX.Element {
  const { connectionId, pullRequestKey } = useLocalSearchParams<{
    connectionId: string;
    pullRequestKey: string;
  }>();
  return (
    <View testID="pull-request-changes">
      <Pressable onPress={() => router.back()} testID="open-details">
        <Text>Details</Text>
      </Pressable>
    </View>
  );
}

function ThreadDetail(): React.JSX.Element {
  const { connectionId, threadId } = useLocalSearchParams<{
    connectionId: string;
    threadId: string;
  }>();
  return <Text testID="canonical-thread">{`${connectionId}:${threadId}`}</Text>;
}

const routeOverrides = {
  _layout: RootLayout,
  "(workspace)/_layout": StackLayout,
  "(workspace)/(tabs)/_layout": {
    default: TabsLayout,
    unstable_settings: { initialRouteName: "(threads)" },
  },
  "(workspace)/(tabs)/(threads)/_layout": {
    default: StackLayout,
    unstable_settings: { anchor: "(lists)", initialRouteName: "(lists)" },
  },
  "(workspace)/(tabs)/(threads)/(lists)/_layout": StackLayout,
  "(workspace)/(tabs)/(threads)/(lists)/index": ThreadsCatalog,
  "(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/_layout": StackLayout,
  "(workspace)/(tabs)/(threads)/threads/[connectionId]/[threadId]/index": ThreadDetail,
  "(workspace)/(tabs)/(pull-requests)/_layout": {
    default: StackLayout,
    unstable_settings: { anchor: "pulls/index", initialRouteName: "pulls/index" },
  },
  "(workspace)/(tabs)/(pull-requests)/pulls/index": PullRequestsCatalog,
  "(workspace)/(tabs)/(pull-requests)/pulls/[connectionId]/[pullRequestKey]/index":
    PullRequestDetails,
  "(workspace)/(tabs)/(pull-requests)/pulls/[connectionId]/[pullRequestKey]/changes":
    PullRequestChanges,
};

function renderProductionTree(initialUrl: string) {
  return renderRouter(
    { appDir: join(__dirname, "../app"), overrides: routeOverrides },
    { initialUrl },
  );
}

type RouterState = NonNullable<ReturnType<ReturnType<typeof renderRouter>["getRouterState"]>>;

function findRoute(state: RouterState | undefined, routeName: string) {
  if (state === undefined) return undefined;
  for (const route of state.routes) {
    if (route.name === routeName) return route;
    const nested = findRoute(route.state, routeName);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

beforeEach(() => {
  mockPrepareLinkedThread.mockClear();
});

it("retains the exact PR detail route while switching tabs", () => {
  const view = renderProductionTree("/pulls/server/pr");
  const detail = view.getByTestId("pull-request-details");

  fireEvent.press(view.getByTestId("tab-(threads)"));
  const detailKey = findRoute(
    view.getRouterState(),
    "pulls/[connectionId]/[pullRequestKey]/index",
  )?.key;
  expect(detailKey).toBeDefined();
  expect(view.getPathname()).toBe("/");
  expect(view.getByTestId("threads-catalog")).toBeVisible();
  expect(view.getByTestId("pull-request-details", { includeHiddenElements: true })).toBe(detail);

  fireEvent.press(view.getByTestId("tab-(pull-requests)"));
  expect(view.getPathname()).toBe("/pulls/server/pr");
  expect(view.getByTestId("pull-request-details")).toBe(detail);
  expect(findRoute(view.getRouterState(), "pulls/[connectionId]/[pullRequestKey]/index")?.key).toBe(
    detailKey,
  );
});

it("retains Changes over the exact Details it was pushed from while switching tabs", () => {
  const view = renderProductionTree("/pulls/server/pr");
  const detail = view.getByTestId("pull-request-details");
  fireEvent.press(view.getByTestId("open-changes"));
  const changes = view.getByTestId("pull-request-changes");
  const changesKey = findRoute(
    view.getRouterState(),
    "pulls/[connectionId]/[pullRequestKey]/changes",
  )?.key;
  expect(view.getPathname()).toBe("/pulls/server/pr/changes");
  expect(view.getByTestId("pull-request-details", { includeHiddenElements: true })).toBe(detail);

  fireEvent.press(view.getByTestId("tab-(threads)"));
  expect(view.getPathname()).toBe("/");
  expect(view.getByTestId("pull-request-changes", { includeHiddenElements: true })).toBe(changes);

  fireEvent.press(view.getByTestId("tab-(pull-requests)"));
  expect(view.getPathname()).toBe("/pulls/server/pr/changes");
  expect(view.getByTestId("pull-request-changes")).toBe(changes);
  expect(
    findRoute(view.getRouterState(), "pulls/[connectionId]/[pullRequestKey]/changes")?.key,
  ).toBe(changesKey);

  fireEvent.press(view.getByTestId("open-details"));
  expect(view.getPathname()).toBe("/pulls/server/pr");
  expect(view.getByTestId("pull-request-details")).toBe(detail);
});

it("navigates compact linked chat into Threads while retaining PR history", () => {
  const view = renderProductionTree("/pulls/server/pr");
  fireEvent.press(view.getByTestId("open-linked-thread"));
  expect(mockPrepareLinkedThread).toHaveBeenCalledWith("server", "linked-thread");
  expect(view.getPathname()).toBe("/threads/server/linked-thread");
  expect(view.getByTestId("canonical-thread")).toHaveTextContent("server:linked-thread");
  expect(
    view.queryByTestId("pull-request-details", { includeHiddenElements: true }),
  ).not.toBeNull();

  testRouter.back();
  expect(view.getPathname()).toBe("/");
  testRouter.back();
  expect(view.getPathname()).toBe("/pulls/server/pr");
  expect(view.getByTestId("pull-request-details")).toBeVisible();
});

it("Back pops a PR detail before tab history", () => {
  const view = renderProductionTree("/pulls/server/pr");
  fireEvent.press(view.getByTestId("back-to-pulls"));
  expect(view.getPathname()).toBe("/pulls");
  expect(view.getByTestId("pull-requests-catalog")).toBeVisible();
});
