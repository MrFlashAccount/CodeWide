import { StyleSheet, Text, View } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { workspaceCatalogDiagnostics } from "../src/data/workspaceCatalogDiagnostics";
import {
  BaseNavigationContainer,
  createNavigationContainerRef,
  ThemeProvider,
} from "expo-router/build/react-navigation/core";
import { DefaultTheme } from "expo-router/build/react-navigation/native";
import { useIsFocused } from "expo-router/build/react-navigation/core/useIsFocused";
import { createNativeStackNavigator } from "expo-router/build/react-navigation/native-stack/navigators/createNativeStackNavigator";

const Wrapper = createNativeStackNavigator();
const Root = createNativeStackNavigator();
const Lists = createNativeStackNavigator();
import {
  WorkspacePaneLayout,
  WorkspaceScreenLayout,
} from "../src/routeComposition/WorkspacePaneLayout";
import {
  catalogModeBarBottomInset,
  catalogModeBarHorizontalInset,
} from "../src/presentation/layouts/catalogModeBarGeometry";
import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";
import { radii } from "../src/theme";
let mockDesktop = false;
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
    PullRequestsCatalogPane: () => (
      <NativeText testID="pull-requests-catalog-pane">Pull requests catalog</NativeText>
    ),
  };
});
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: mockDesktop,
    runtime: { connectionProfiles: null, ready: false },
    viewportWidth: mockDesktop ? 1100 : 400,
  }),
}));
const mockReference = createNavigationContainerRef();
jest.mock("expo-router", () => ({ useNavigationContainerRef: () => mockReference }));
import { useWorkspaceProjectSessionId } from "../src/routeComposition/workspaceProjectNavigation";
function RootList() {
  const focused = useIsFocused();
  return (
    <View>
      <Text testID="root-list">Root</Text>
      <Text testID="catalog-focus">{focused ? "focused" : "unfocused"}</Text>
    </View>
  );
}
function Project() {
  return <Text testID="project-list">Project</Text>;
}
function Thread() {
  return <Text testID="thread">Thread</Text>;
}
function PullRequests() {
  return (
    <View testID="pull-requests-route">
      <Text testID="pull-requests-header">Pull requests</Text>
    </View>
  );
}
function PullRequestDetail() {
  return <Text testID="pull-request-detail">Pull request detail</Text>;
}
function Catalog() {
  const selectedProject = useWorkspaceProjectSessionId();
  return (
    <View>
      <Text testID="header">{selectedProject ?? "Root"}</Text>
      <Lists.Navigator>
        <Lists.Screen name="index" component={RootList} />
        <Lists.Screen name="project/[sessionId]" component={Project} />
      </Lists.Navigator>
    </View>
  );
}
function Workspace() {
  return (
    <Root.Navigator layout={WorkspacePaneLayout} screenLayout={WorkspaceScreenLayout}>
      <Root.Screen name="(lists)" component={Catalog} />
      <Root.Screen name="pulls/index" component={PullRequests} />
      <Root.Screen
        name="pulls/[connectionId]/[pullRequestKey]"
        component={PullRequestDetail}
      />
      <Root.Screen name="thread" component={Thread} />
    </Root.Navigator>
  );
}
function Application() {
  return (
    <BaseNavigationContainer ref={mockReference}>
      <ThemeProvider value={DefaultTheme}>
        <Wrapper.Navigator>
          <Wrapper.Screen name="(workspace)" component={Workspace} />
        </Wrapper.Navigator>
      </ThemeProvider>
    </BaseNavigationContainer>
  );
}
it("mounts the catalog once outside the detail stack and updates it without changing the detail", () => {
  mockDesktop = false;
  const view = render(<Application />);
  expect(view.getAllByTestId("header")).toHaveLength(1);
  expect(view.getByTestId("catalog-focus").props.children).toBe("focused");
  const header = view.getByTestId("header");
  mockDesktop = true;
  view.rerender(<Application />);
  expect(view.getByTestId("header")).toBe(header);
  const workspaceKey = mockReference.getRootState().routes[0]?.state?.key;
  act(() =>
    mockReference.dispatch({ type: "PUSH", target: workspaceKey, payload: { name: "thread" } }),
  );
  const thread = view.getByTestId("thread");
  expect(view.getByTestId("catalog-focus").props.children).toBe("unfocused");
  const state = mockReference.getRootState();
  const workspace = state.routes[0]?.state;
  const catalog = workspace?.routes[0]?.state;
  if (!catalog?.key) throw new Error("Catalog not mounted");
  act(() =>
    mockReference.dispatch({
      type: "PUSH",
      target: catalog.key,
      payload: { name: "project/[sessionId]", params: { sessionId: "project-list-test" } },
    }),
  );
  expect(mockReference.getCurrentRoute()?.name).toBe("thread");
  expect(view.getByTestId("thread")).toBe(thread);
  expect(view.getByTestId("header")).toBe(header);
  expect(view.getByTestId("project-list", { includeHiddenElements: true })).toBeTruthy();
  expect(view.getByTestId("header").props.children).toBe("project-list-test");
  mockDesktop = false;
  view.rerender(<Application />);
  expect(mockReference.getCurrentRoute()?.name).toBe("thread");
  expect(view.getByTestId("thread")).toBe(thread);
  act(() => mockReference.goBack());
  expect(mockReference.getCurrentRoute()?.name).toBe("project/[sessionId]");
  expect(view.getByTestId("header")).toBe(header);
  act(() => mockReference.goBack());
  expect(mockReference.getCurrentRoute()?.name).toBe("index");
  expect(view.getByTestId("catalog-focus").props.children).toBe("focused");
  view.unmount();
});

it("keeps the wide catalog geometry while switching to the Pull requests route", () => {
  mockDesktop = true;
  const view = render(<Application />);
  const workspaceKey = mockReference.getRootState().routes[0]?.state?.key;
  const catalogPane = view.getByTestId("workspace-catalog-pane");
  const modeBar = view.getByTestId("catalog-mode-bar-host");
  expect(view.getByTestId("header")).toBeVisible();
  const floatingModeBar = view.getByTestId("floating-catalog-mode-bar");
  expect(floatingModeBar).toHaveStyle({
    bottom: catalogModeBarBottomInset,
    position: "absolute",
  });
  expect(StyleSheet.flatten(floatingModeBar.props.style).width).toBe(
    desktopThreadSidebarWidth(1100) - catalogModeBarHorizontalInset * 2,
  );
  expect(modeBar.props.children).toBe("threads");

  act(() =>
    mockReference.dispatch({
      type: "REPLACE",
      target: workspaceKey,
      payload: { name: "pulls/index" },
    }),
  );

  expect(view.getByTestId("pull-requests-route")).toBeVisible();
  expect(view.getByTestId("pull-requests-header")).toBeVisible();
  expect(view.getByTestId("catalog-mode-bar-host")).toBe(modeBar);
  expect(modeBar.props.children).toBe("pullRequests");
  expect(view.getByTestId("floating-catalog-mode-bar")).toBe(floatingModeBar);
  expect(StyleSheet.flatten(floatingModeBar.props.style).width).toBe(
    desktopThreadSidebarWidth(1100) - catalogModeBarHorizontalInset * 2,
  );
  expect(view.getByTestId("workspace-catalog-pane")).toBe(catalogPane);
  expect(catalogPane).not.toHaveStyle({ display: "none" });
  expect(StyleSheet.flatten(catalogPane.props.style).width).toBe(desktopThreadSidebarWidth(1100));
  expect(view.getByTestId("pull-requests-catalog-pane")).toBeVisible();
  expect(view.queryByTestId("header", { includeHiddenElements: true })).toBeNull();
  expect(view.getByTestId("v1-workspace-destination")).toHaveStyle({
    borderBottomLeftRadius: radii.composer,
    borderTopLeftRadius: radii.composer,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  });

  act(() =>
    mockReference.dispatch({
      type: "REPLACE",
      target: workspaceKey,
      payload: { name: "(lists)" },
    }),
  );
  expect(view.getByTestId("workspace-catalog-pane")).not.toHaveStyle({ display: "none" });
  expect(view.getByTestId("header")).toBeVisible();
  expect(view.queryByTestId("pull-requests-route")).toBeNull();
  view.unmount();
});

it("keeps the Pull requests catalog beside a wide pull-request detail", () => {
  mockDesktop = true;
  const view = render(<Application />);
  const workspaceKey = mockReference.getRootState().routes[0]?.state?.key;
  act(() =>
    mockReference.dispatch({
      type: "REPLACE",
      target: workspaceKey,
      payload: { name: "pulls/index" },
    }),
  );
  const pullRequestsCatalog = view.getByTestId("pull-requests-catalog-pane");

  act(() =>
    mockReference.dispatch({
      type: "PUSH",
      target: workspaceKey,
      payload: {
        name: "pulls/[connectionId]/[pullRequestKey]",
        params: { connectionId: "server", pullRequestKey: "pull-request" },
      },
    }),
  );

  expect(view.getByTestId("pull-request-detail")).toBeVisible();
  expect(view.getByTestId("pull-requests-catalog-pane")).toBe(pullRequestsCatalog);
  expect(view.getByTestId("workspace-catalog-pane")).not.toHaveStyle({ display: "none" });
  expect(view.getByTestId("catalog-mode-bar-host").props.children).toBe("pullRequests");
  view.unmount();
});

it("distinguishes an empty reserved pane from a missing native layout without storing route payloads", () => {
  mockDesktop = true;
  const view = render(<Application />);
  const pane = view.getByTestId("workspace-catalog-pane");
  fireEvent(pane, "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: 374, height: 700 } },
  });
  expect(view.getByTestId("header")).toBeVisible();
  const workspaceKey = mockReference.getRootState().routes[0]?.state?.key;
  // Exercise the missing-route diagnostic branch, not a claimed production reproduction.
  act(() =>
    mockReference.dispatch({
      type: "REPLACE",
      target: workspaceKey,
      payload: { name: "thread", params: { privateText: "private-route-payload" } },
    }),
  );
  expect(view.queryByTestId("header")).toBeNull();
  expect(view.getByTestId("workspace-catalog-pane")).toBe(pane);
  const report = workspaceCatalogDiagnostics.report();
  expect(report).toContain('"catalog": "missing-route"');
  expect(report).toContain('"surface": "pane"');
  expect(report).toContain('"width": 374');
  expect(report).not.toContain("private-route-payload");
  view.unmount();
});
