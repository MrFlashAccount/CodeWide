import { act, render } from "@testing-library/react-native";
import {
  BaseNavigationContainer,
  createNavigationContainerRef,
  ThemeProvider,
} from "expo-router/build/react-navigation/core";
import { DefaultTheme } from "expo-router/build/react-navigation/native";
import { createNativeStackNavigator } from "expo-router/build/react-navigation/native-stack/navigators/createNativeStackNavigator";
import { Text, View } from "react-native";

import {
  PullRequestsWorkspacePaneLayout,
  PullRequestsWorkspaceScreenLayout,
} from "../src/routeComposition/PullRequestsWorkspaceRouteLayout";
import {
  ThreadsWorkspacePaneLayout,
  ThreadsWorkspaceScreenLayout,
} from "../src/routeComposition/ThreadsWorkspaceRouteLayout";

const Root = createNativeStackNavigator();
const Threads = createNativeStackNavigator();
const PullRequests = createNativeStackNavigator();
const navigation = createNavigationContainerRef();

let mockDesktop = true;

jest.mock("../src/routeComposition/CatalogModeBarHost", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    CatalogModeBarHost: ({ mode }: { readonly mode: string }) => (
      <NativeText testID="catalog-mode-bar-host">{mode}</NativeText>
    ),
  };
});
jest.mock("../src/routeComposition/PullRequestsCatalogRoute", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    PullRequestsPreviewRoute: () => (
      <NativeText testID="pull-requests-preview-pane">Select a pull request</NativeText>
    ),
  };
});
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: mockDesktop,
    runtime: { connectionProfiles: { collection: { toArray: [{ id: "server" }] } }, ready: true },
    viewportWidth: mockDesktop ? 1100 : 400,
  }),
}));

function ThreadsCatalog(): React.JSX.Element {
  return <Text testID="threads-catalog">Threads</Text>;
}

function ThreadDetail(): React.JSX.Element {
  return <Text testID="thread-detail">Thread detail</Text>;
}

function Projects(): React.JSX.Element {
  return <Text testID="projects">Projects</Text>;
}

function PullRequestsCatalog(): React.JSX.Element {
  return <Text testID="pull-requests-catalog">Pull requests</Text>;
}

function PullRequestDetail(): React.JSX.Element {
  return <Text testID="pull-request-detail">Pull request detail</Text>;
}

function PullRequestChanges(): React.JSX.Element {
  return <Text testID="pull-request-changes">Pull request changes</Text>;
}

function ThreadsSubtree(): React.JSX.Element {
  return (
    <Threads.Navigator
      initialRouteName="(lists)"
      layout={ThreadsWorkspacePaneLayout}
      screenLayout={ThreadsWorkspaceScreenLayout}
    >
      <Threads.Screen name="(lists)" component={ThreadsCatalog} />
      <Threads.Screen name="threads/detail" component={ThreadDetail} />
      <Threads.Screen name="projects/index" component={Projects} />
    </Threads.Navigator>
  );
}

function PullRequestsSubtree(): React.JSX.Element {
  return (
    <PullRequests.Navigator
      initialRouteName="pulls/index"
      layout={PullRequestsWorkspacePaneLayout}
      screenLayout={PullRequestsWorkspaceScreenLayout}
    >
      <PullRequests.Screen name="pulls/index" component={PullRequestsCatalog} />
      <PullRequests.Screen name="pulls/detail" component={PullRequestDetail} />
      <PullRequests.Screen name="pulls/changes" component={PullRequestChanges} />
    </PullRequests.Navigator>
  );
}

function Application(): React.JSX.Element {
  return (
    <BaseNavigationContainer ref={navigation}>
      <ThemeProvider value={DefaultTheme}>
        <Root.Navigator initialRouteName="(threads)">
          <Root.Screen name="(threads)" component={ThreadsSubtree} />
          <Root.Screen name="(pull-requests)" component={PullRequestsSubtree} />
        </Root.Navigator>
      </ThemeProvider>
    </BaseNavigationContainer>
  );
}

function rootState() {
  const state = navigation.getRootState();
  if (state.key === undefined) throw new Error("Root stack is unavailable");
  return state;
}

function subtreeState() {
  const root = rootState();
  const subtree = root.routes[root.index ?? 0]?.state;
  if (subtree?.key === undefined) throw new Error("Active subtree stack is unavailable");
  return subtree;
}

function replaceRoot(name: "(pull-requests)" | "(threads)"): void {
  const root = rootState();
  navigation.dispatch({ payload: { name }, target: root.key, type: "REPLACE" });
}

it("keeps Threads geometry responsive without changing its Router identity", () => {
  mockDesktop = true;
  const view = render(<Application />);
  const threads = subtreeState();
  act(() => {
    navigation.dispatch({ payload: { name: "threads/detail" }, target: threads.key, type: "PUSH" });
  });
  const routeKey = subtreeState().routes.at(-1)?.key;
  expect(view.getByTestId("threads-catalog")).toBeVisible();
  expect(view.getByTestId("thread-detail")).toBeVisible();

  mockDesktop = false;
  view.rerender(<Application />);

  expect(subtreeState().routes.at(-1)?.key).toBe(routeKey);
  expect(view.getByTestId("thread-detail")).toBeVisible();
  view.unmount();
});

it("keeps one real PR catalog descriptor and removes a closed detail node", () => {
  mockDesktop = true;
  const view = render(<Application />);
  act(() => replaceRoot("(pull-requests)"));
  const pulls = subtreeState();
  expect(view.getAllByTestId("pull-requests-catalog")).toHaveLength(1);
  expect(view.getByTestId("pull-requests-preview-pane")).toBeVisible();

  act(() => {
    navigation.dispatch({ payload: { name: "pulls/detail" }, target: pulls.key, type: "PUSH" });
  });
  expect(view.getByTestId("pull-request-detail")).toBeVisible();

  act(() => navigation.goBack());
  expect(view.queryByTestId("pull-request-detail", { includeHiddenElements: true })).toBeNull();
  expect(subtreeState().routes.map((route) => route.name)).toEqual(["pulls/index"]);
  view.unmount();
});

it("replaces Details and Changes without stacking two PR detail routes", () => {
  const view = render(<Application />);
  act(() => replaceRoot("(pull-requests)"));
  const pulls = subtreeState();
  act(() => {
    navigation.dispatch({ payload: { name: "pulls/detail" }, target: pulls.key, type: "PUSH" });
    navigation.dispatch({ payload: { name: "pulls/changes" }, target: pulls.key, type: "REPLACE" });
  });

  expect(subtreeState().routes.map((route) => route.name)).toEqual([
    "pulls/index",
    "pulls/changes",
  ]);
  expect(view.queryByTestId("pull-request-detail", { includeHiddenElements: true })).toBeNull();
  expect(view.getByTestId("pull-request-changes")).toBeVisible();
  view.unmount();
});

it("physically removes the PR subtree before Projects opens inside Threads", () => {
  const view = render(<Application />);
  act(() => replaceRoot("(pull-requests)"));
  const pulls = subtreeState();
  act(() => {
    navigation.dispatch({ payload: { name: "pulls/detail" }, target: pulls.key, type: "PUSH" });
  });
  expect(view.getByTestId("pull-request-detail")).toBeVisible();

  act(() => replaceRoot("(threads)"));
  expect(rootState().routes.map((route) => route.name)).toEqual(["(threads)"]);
  expect(view.queryByTestId("pull-request-detail", { includeHiddenElements: true })).toBeNull();
  expect(view.queryByTestId("pull-requests-catalog", { includeHiddenElements: true })).toBeNull();

  const threads = subtreeState();
  act(() => {
    navigation.dispatch({ payload: { name: "projects/index" }, target: threads.key, type: "PUSH" });
  });
  expect(view.getByTestId("projects")).toBeVisible();
  expect(view.queryByTestId("pull-request-detail", { includeHiddenElements: true })).toBeNull();
  view.unmount();
});
