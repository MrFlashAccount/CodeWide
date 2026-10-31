import { act, fireEvent, render, within } from "@testing-library/react-native";
import { useEffect, type ReactNode } from "react";
import { Pressable, Text } from "react-native";
import {
  BaseNavigationContainer,
  createNavigationContainerRef,
  ThemeProvider,
  useIsFocused as useNavigationFocus,
} from "expo-router/build/react-navigation/core";
import { DefaultTheme } from "expo-router/build/react-navigation/native";
import { createNativeStackNavigator } from "expo-router/build/react-navigation/native-stack/navigators/createNativeStackNavigator";

import V1ProjectsRoute from "../app/(workspace)/(tabs)/(threads)/projects/index";
import { ProjectDirectoryPicker } from "../src/features/projects/ProjectDirectoryPicker";
import {
  ThreadsWorkspacePaneLayout,
  ThreadsWorkspaceScreenLayout,
} from "../src/routeComposition/ThreadsWorkspaceRouteLayout";
import { v1SheetScreenOptions } from "../src/routeComposition/WorkspaceShell.styles";

let mockDesktop = true;
const mockNativeSheet: { dismiss: (() => void) | null } = { dismiss: null };

// WHY: Node cannot create the external Compose sheet window; the mock marks the window owner and
// exposes its native dismissal so the real AppSheet lifecycle stays under test.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: NativeView } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const ModalBottomSheet = React.forwardRef(function MockModalBottomSheet(
    {
      children,
      onDismissRequest,
    }: { readonly children?: ReactNode; readonly onDismissRequest: () => void },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: async () => undefined }), []);
    mockNativeSheet.dismiss = onDismissRequest;
    return <NativeView testID="native-sheet-window">{children}</NativeView>;
  });
  return { Host, ModalBottomSheet, RNHostView: Host };
});
jest.mock("../src/routeComposition/CatalogModeBarHost", () => ({ CatalogModeBarHost: () => null }));
jest.mock("../src/data/workspace-runtime", () => ({ workspaceRuntime: { native: true } }));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: { projects: {} },
}));
jest.mock("../src/features/projects/projectWorkspace", () => ({
  useProjectWorkspace: () => ({
    availableSidebarProjects: [
      {
        connectionId: "server",
        key: "server:/workspace/project",
        lastUsedAt: 1,
        name: "Project",
        path: "/workspace/project",
        pinned: true,
        serverLabel: null,
        subtitle: "/workspace/project",
        unread: false,
      },
    ],
    moveSidebarProject: async () => undefined,
    sidebarProjectErrors: [],
    sidebarServers: [{ id: "server", name: "Server" }],
    toggleSidebarProject: async () => undefined,
  }),
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    connections: [],
    desktop: mockDesktop,
    list: { servers: [{ id: "server", name: "Server" }] },
    runtime: {
      connectionProfiles: { collection: { toArray: [{ id: "server" }] } },
      ready: true,
      threadSummaries: null,
    },
    viewportWidth: mockDesktop ? 1100 : 400,
  }),
}));

const Threads = createNativeStackNavigator();
const navigation = createNavigationContainerRef();
const newChatMounts = { count: 0 };

function ThreadsCatalog(): React.JSX.Element {
  return <Text testID="threads-catalog">Threads</Text>;
}

/** Stands in for the New Chat destination whose project picker opens `/projects`. */
function NewChat(): React.JSX.Element {
  useEffect(() => {
    newChatMounts.count += 1;
  }, []);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        navigation.dispatch({ payload: { name: "projects/index" }, type: "PUSH" });
      }}
      testID="new-chat"
    >
      <Text>Manage projects</Text>
    </Pressable>
  );
}

function Application(): React.JSX.Element {
  return (
    <BaseNavigationContainer ref={navigation}>
      <ThemeProvider value={DefaultTheme}>
        <Threads.Navigator
          initialRouteName="(lists)"
          layout={ThreadsWorkspacePaneLayout}
          screenLayout={ThreadsWorkspaceScreenLayout}
        >
          <Threads.Screen component={ThreadsCatalog} name="(lists)" />
          <Threads.Screen component={NewChat} name="new/index" />
          <Threads.Screen
            component={V1ProjectsRoute}
            name="projects/index"
            options={v1SheetScreenOptions}
          />
        </Threads.Navigator>
      </ThemeProvider>
    </BaseNavigationContainer>
  );
}

function routeNames(): readonly string[] {
  return navigation.getRootState().routes.map((route) => route.name);
}

beforeEach(() => {
  newChatMounts.count = 0;
  mockNativeSheet.dismiss = null;
  // The v1 Jest config maps `expo-router` to test/mocks/ExpoRouter; requireActual returns that
  // exact instance (requireMock would return a separate automock the route never sees).
  const expoRouter = jest.requireActual<{
    readonly router: { back: () => void; canGoBack: () => boolean };
    readonly useIsFocused: jest.Mock;
  }>("expo-router");
  // The production route reads focus and history through Expo Router; bind both to the real stack.
  expoRouter.useIsFocused.mockImplementation(useNavigationFocus);
  jest.spyOn(expoRouter.router, "canGoBack").mockImplementation(() => navigation.canGoBack());
  jest.spyOn(expoRouter.router, "back").mockImplementation(() => {
    navigation.goBack();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

it.each([
  ["unfolded three-pane", true],
  ["folded phone", false],
])(
  "presents Manage Projects as an app sheet over the retained New Chat (%s)",
  (_layout, desktop) => {
    mockDesktop = desktop;
    const view = render(<Application />);
    act(() => {
      navigation.dispatch({ payload: { name: "new/index" }, type: "PUSH" });
    });
    expect(view.getByTestId("new-chat")).toBeVisible();
    expect(newChatMounts.count).toBe(1);

    fireEvent.press(view.getByTestId("new-chat"));

    expect(routeNames()).toEqual(["(lists)", "new/index", "projects/index"]);
    // The surface belongs to the native sheet window, not to a React layer drawn in the pane.
    const sheet = view.getByTestId("native-sheet-window");
    expect(within(sheet).getByText("Manage Projects")).toBeVisible();
    expect(view.queryByLabelText("Close project management")).toBeNull();
    // The covered destination stays mounted (not replaced) beneath the transparent sheet route;
    // only the modal hides it from assistive technology while the sheet is open.
    expect(view.getByTestId("new-chat", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(newChatMounts.count).toBe(1);

    // Native dismissal (Back, outside tap or swipe) closes the route through Router history.
    act(() => {
      mockNativeSheet.dismiss?.();
    });

    expect(routeNames()).toEqual(["(lists)", "new/index"]);
    expect(view.queryByTestId("native-sheet-window")).toBeNull();
    expect(view.getByTestId("new-chat")).toBeVisible();
    expect(newChatMounts.count).toBe(1);
    view.unmount();
  },
);

it("presents the Add project browser through the native sheet window", () => {
  const onClose = jest.fn();
  const view = render(
    <ProjectDirectoryPicker
      connections={[]}
      initialConnectionId={null}
      native={false}
      onAddProject={jest.fn()}
      onClose={onClose}
      remote={{ readDirectory: jest.fn(), readProjectHome: jest.fn() }}
      servers={[]}
      visible
    />,
  );

  expect(within(view.getByTestId("native-sheet-window")).getByText("Add project")).toBeVisible();
  expect(view.queryByLabelText("Close project picker")).toBeNull();
  act(() => {
    mockNativeSheet.dismiss?.();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
