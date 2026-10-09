import { act, fireEvent, render } from "@testing-library/react-native";
import { Dimensions, Text, View } from "react-native";
import { Gesture, State } from "react-native-gesture-handler";
import * as Reanimated from "react-native-reanimated";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";
import { BrowserSheet } from "../src/features/browser/BrowserSheet";
import { BrowserWorkspace } from "../src/features/browser/BrowserWorkspace";
import { BrowserWorkspaceHost } from "../src/features/browser/BrowserWorkspaceHost";
import { browserPresentation } from "../src/services/browser/browserPresentation";
import { BrowserTabsModel } from "../src/services/browser/browserTabsModel";
import {
  v1ThreadRouteParams,
  workspaceRouteSessionOwner,
} from "../src/services/threads/threadRouteParams";
import { browserRouteSessions } from "../src/services/browser/browserRouteSession";
import { disposeAllRouteSessions } from "../src/services/routeSessionPolicy";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";

const mockMounts = new Set<object>();
jest.mock("react-native-webview", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const Native = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    WebView: React.forwardRef(function Page(_props, ref) {
      const identity = React.useRef({}).current;
      React.useEffect(() => {
        mockMounts.add(identity);
        return () => {
          mockMounts.delete(identity);
        };
      }, [identity]);
      React.useImperativeHandle(ref, () => ({
        goBack: jest.fn(),
        goForward: jest.fn(),
        injectJavaScript: jest.fn(),
        reload: jest.fn(),
        stopLoading: jest.fn(),
      }));
      return <Native.View testID="retained-browser-page" />;
    }),
  };
});

function drag(distance: number, state = State.END, velocityY = 0): void {
  act(() =>
    fireGestureHandler<ReturnType<typeof Gesture.Pan>>(
      getByGestureTestId("browser-sheet-grip-pan"),
      [
        { numberOfPointers: 1, state: State.BEGAN, translationX: 0, translationY: 0, velocityY: 0 },
        {
          numberOfPointers: 1,
          state: State.ACTIVE,
          translationX: 0,
          translationY: distance,
          velocityY,
        },
        { numberOfPointers: 1, state, translationX: 0, translationY: distance, velocityY },
      ],
    ),
  );
}
function setViewport(width: number, height: number): void {
  act(() =>
    Dimensions.set({
      screen: { fontScale: 1, height, scale: 1, width },
      window: { fontScale: 1, height, scale: 1, width },
    }),
  );
}
beforeEach(() => setViewport(390, 800));
afterEach(() => {
  browserPresentation.clear();
  disposeAllRouteSessions();
  mockMounts.clear();
});

it("collapses from a deliberate handle drag, while tap, short drag and cancellation retain the open sheet", () => {
  const collapse = jest.fn();
  const view = render(
    <BrowserSheet active onCollapse={collapse} presentationId="first">
      <View testID="page-content">
        <Text>Page</Text>
      </View>
    </BrowserSheet>,
  );
  fireEvent(view.getByTestId("browser-sheet"), "layout", {
    nativeEvent: { layout: { height: 800, width: 390, x: 0, y: 0 } },
  });
  fireEvent.press(view.getByLabelText("Browser sheet handle"));
  fireEvent(view.getByTestId("page-content"), "touchMove", { nativeEvent: { pageY: 200 } });
  drag(25);
  drag(120, State.CANCELLED);
  expect(collapse).not.toHaveBeenCalled();
  drag(120);
  expect(collapse).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText("Close browser")).toBeNull();
  expect(view.queryByLabelText("Back to chat")).toBeNull();
});

it("offers an accessible collapse action without adding a visual close control", () => {
  const collapse = jest.fn();
  const view = render(
    <BrowserSheet active onCollapse={collapse} presentationId="first">
      <Text>Page</Text>
    </BrowserSheet>,
  );
  fireEvent(view.getByLabelText("Browser sheet handle"), "accessibilityAction", {
    nativeEvent: { actionName: "collapse" },
  });
  expect(collapse).toHaveBeenCalledTimes(1);
  view.rerender(
    <BrowserSheet active={false} onCollapse={collapse} presentationId="first">
      <Text>Page</Text>
    </BrowserSheet>,
  );
  fireEvent(view.getByLabelText("Browser sheet handle"), "accessibilityAction", {
    nativeEvent: { actionName: "collapse" },
  });
  expect(collapse).toHaveBeenCalledTimes(1);
});

it("ignores completion of an old gesture after a different presentation opens", () => {
  let finish: ((finished: boolean) => void) | undefined;
  const animation = jest
    .spyOn(Reanimated, "withTiming")
    .mockImplementation((value, _config, callback) => {
      finish = callback;
      return value;
    });
  try {
    const collapse = jest.fn();
    const view = render(
      <BrowserSheet active onCollapse={collapse} presentationId="first">
        <Text>Page</Text>
      </BrowserSheet>,
    );
    drag(120);
    const previous = finish;
    view.rerender(
      <BrowserSheet active onCollapse={collapse} presentationId="second">
        <Text>Page</Text>
      </BrowserSheet>,
    );
    act(() => previous?.(true));
    expect(collapse).not.toHaveBeenCalled();
  } finally {
    animation.mockRestore();
  }
});

it("retains the same mounted pages through the tab manager, layout changes and tab switching", () => {
  const tabs = new BrowserTabsModel();
  const first = tabs.open({ title: "First page", url: "https://first.example/?token=private" });
  tabs.open({ title: "Second page", url: "https://second.example/" });
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace onClose={jest.fn()} tabs={tabs} />
    </AppFullscreenOverlayProvider>,
  );
  const mounts = Array.from(mockMounts);
  expect(view.queryByLabelText("Select browser tab: First page · first.example")).toBeNull();
  fireEvent.press(view.getByLabelText("Open browser tabs: 2"));
  expect(view.getByTestId("browser-tabs-overview")).toBeVisible();
  expect(view.getByText("First page")).toBeTruthy();
  expect(view.queryByText("https://first.example/?token=private")).toBeNull();
  fireEvent.press(view.getByLabelText("Show tabs as list"));
  fireEvent.press(view.getByLabelText("Select browser tab: First page · first.example"));
  const selected = tabs.state$.peek();
  if (selected.kind !== "tabs") throw new Error("No tab selected");
  expect(selected.selected.id).toBe(first.id);
  expect(view.queryByTestId("browser-tabs-overview")).toBeNull();
  setViewport(800, 390);
  expect(view.getByLabelText("Select browser tab: First page · first.example")).toBeVisible();
  expect(view.getByLabelText("Forward")).toBeVisible();
  expect(mockMounts.size).toBe(mounts.length);
  mounts.forEach((identity) => expect(mockMounts.has(identity)).toBe(true));
});

it("returns Home after closing the last tab and opens local Home tabs without a WebView", () => {
  const tabs = new BrowserTabsModel();
  tabs.open({ title: "First", url: "https://first.example/" });
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace onClose={jest.fn()} tabs={tabs} />
    </AppFullscreenOverlayProvider>,
  );
  fireEvent.press(view.getByLabelText("Open browser tabs: 1"));
  fireEvent.press(view.getByLabelText("Close browser tab: First · first.example"));
  expect(view.getByTestId("browser-home")).toBeVisible();
  expect(view.queryByText("No tabs yet")).toBeNull();
  expect(mockMounts.size).toBe(0);
  expect(tabs.state$.peek()).toMatchObject({
    kind: "tabs",
    selected: { destination: null },
  });
  expect(view.getByLabelText("Open browser tabs: 1")).toBeVisible();
  expect(mockMounts.size).toBe(0);
  fireEvent.press(view.getByLabelText("Open browser tabs: 1"));
  expect(view.queryByLabelText("Return to page")).toBeNull();
  expect(view.queryByLabelText("Close browser tab: Home")).toBeNull();
  fireEvent.press(view.getByLabelText("Select browser tab: Home"));
  expect(view.getByTestId("browser-home")).toBeVisible();
  expect(view.getByLabelText("Open browser tabs: 1")).toBeVisible();
});

it("opening an empty browser starts Home without inventing a network page", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "chat" });
  if (parsed.status !== "valid") throw new Error("Invalid test identity");
  const session = browserRouteSessions.openTabs(workspaceRouteSessionOwner, parsed.value);
  expect(session.tabs.state$.peek().kind).toBe("tabs");
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspaceHost />
    </AppFullscreenOverlayProvider>,
  );
  act(() =>
    browserPresentation.show({
      initialView: session.initialView,
      onDismiss: jest.fn(),
      sessionId: session.id,
      tabs: session.tabs,
      thread: session.thread,
    }),
  );
  expect(view.getByTestId("browser-tabs-overview")).toBeVisible();
  expect(view.queryByText("No tabs yet")).toBeNull();
  expect(mockMounts.size).toBe(0);
  fireEvent.press(view.getByLabelText("Select browser tab: Home"));
  expect(view.getByTestId("browser-home")).toBeVisible();
});

it("the wide plus selects a new Home page even when an empty catalog was opened through the manager", () => {
  setViewport(856, 950);
  const tabs = new BrowserTabsModel();
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace initialView="tabs" onClose={jest.fn()} tabs={tabs} />
    </AppFullscreenOverlayProvider>,
  );
  fireEvent.press(view.getByLabelText("New browser tab"));
  expect(view.getByTestId("browser-home")).toBeVisible();
  expect(view.getByLabelText("Browser address")).toBeVisible();
  expect(view.queryByTestId("browser-tabs-overview")).toBeNull();
  expect(tabs.state$.peek()).toMatchObject({
    kind: "tabs",
    before: [],
    after: [],
    selected: { destination: null },
  });
  expect(mockMounts.size).toBe(0);
});

it("the Browser entry resumes the selected page without opening Tabs or creating a tab", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "chat" });
  if (parsed.status !== "valid") throw new Error("Invalid test identity");
  const first = browserRouteSessions.open(
    workspaceRouteSessionOwner,
    { title: "Page", url: "https://example.com/" },
    parsed.value,
  );
  const selected = first.tabs.state$.peek();
  browserRouteSessions.close(first.id);
  const reopened = browserRouteSessions.resume(workspaceRouteSessionOwner, parsed.value);
  expect(reopened.tabs.state$.peek()).toBe(selected);
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace
        initialView={reopened.initialView}
        onClose={jest.fn()}
        tabs={reopened.tabs}
      />
    </AppFullscreenOverlayProvider>,
  );
  expect(view.getByLabelText("Browser address")).toBeVisible();
  expect(view.queryByTestId("browser-tabs-overview")).toBeNull();
  expect(mockMounts.size).toBe(1);
});

it("collapses without unmounting and reopens completely with the same selected page", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "chat" });
  if (parsed.status !== "valid") throw new Error("Invalid test identity");
  const session = browserRouteSessions.open(
    workspaceRouteSessionOwner,
    { title: "Page", url: "https://example.com/" },
    parsed.value,
  );
  const collapse = jest.fn();
  const dismiss = (): void => {
    collapse();
    browserPresentation.hide(session.id);
  };
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspaceHost />
    </AppFullscreenOverlayProvider>,
  );
  act(() =>
    browserPresentation.show({
      onDismiss: dismiss,
      sessionId: session.id,
      tabs: session.tabs,
      thread: session.thread,
    }),
  );
  const mounts = Array.from(mockMounts);
  drag(120);
  expect(collapse).toHaveBeenCalledTimes(1);
  expect(
    view.getByTestId("browser-workspace-host", { includeHiddenElements: true }),
  ).not.toBeVisible();
  act(() =>
    browserPresentation.show({
      onDismiss: dismiss,
      sessionId: "second",
      tabs: session.tabs,
      thread: session.thread,
    }),
  );
  expect(view.getByTestId("browser-sheet")).toBeVisible();
  expect(mockMounts.size).toBe(mounts.length);
  mounts.forEach((identity) => expect(mockMounts.has(identity)).toBe(true));
});

it("opens a first page in the same Home tab and retains it while browsing other tabs", () => {
  const tabs = new BrowserTabsModel();
  const home = tabs.openHome();
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace onClose={jest.fn()} tabs={tabs} />
    </AppFullscreenOverlayProvider>,
  );
  expect(mockMounts.size).toBe(0);
  const address = view.getByLabelText("Browser address");
  fireEvent(address, "focus");
  fireEvent.changeText(address, "https://example.com/");
  fireEvent(address, "submitEditing");
  expect(tabs.state$.peek()).toMatchObject({ kind: "tabs", selected: { id: home.id } });
  expect(home.destination?.url).toBe("https://example.com/");
  const mounts = Array.from(mockMounts);
  expect(mounts).toHaveLength(1);
  act(() => {
    tabs.openHome();
  });
  expect(view.getByTestId("browser-home")).toBeVisible();
  expect(mockMounts.size).toBe(1);
  act(() => {
    tabs.select(home.id);
  });
  expect(view.queryByTestId("browser-home")).toBeNull();
  mounts.forEach((identity) => expect(mockMounts.has(identity)).toBe(true));
});

it("keeps navigation controls on wide Home and opens the manager from the menu without a duplicate tab counter", () => {
  setViewport(856, 950);
  const tabs = new BrowserTabsModel();
  tabs.openHome();
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace onClose={jest.fn()} tabs={tabs} />
    </AppFullscreenOverlayProvider>,
  );
  expect(view.getByLabelText("Back")).toBeDisabled();
  expect(view.getByLabelText("Forward")).toBeDisabled();
  expect(view.getByLabelText("Reload")).toBeDisabled();
  expect(view.queryByLabelText("Open browser tabs: 1")).toBeNull();
  expect(view.getByLabelText("Select browser tab: Home")).toBeVisible();
  fireEvent.press(view.getByLabelText("Browser menu"));
  fireEvent.press(view.getByLabelText("Browser menu: Tabs"));
  expect(view.getByTestId("browser-tabs-overview")).toBeVisible();
});

it("animates each full opening, including reopening a retained sheet", () => {
  const timing = jest.spyOn(Reanimated, "withTiming");
  try {
    const props = { onCollapse: jest.fn(), presentationId: "first" };
    const view = render(
      <BrowserSheet {...props} active={false}>
        <Text>Page</Text>
      </BrowserSheet>,
    );
    timing.mockClear();
    view.rerender(
      <BrowserSheet {...props} active>
        <Text>Page</Text>
      </BrowserSheet>,
    );
    expect(
      timing.mock.calls.some(([target, config]) => target === 0 && (config?.duration ?? 0) > 0),
    ).toBe(true);
    view.rerender(
      <BrowserSheet {...props} active={false}>
        <Text>Page</Text>
      </BrowserSheet>,
    );
    timing.mockClear();
    view.rerender(
      <BrowserSheet {...props} active presentationId="second">
        <Text>Page</Text>
      </BrowserSheet>,
    );
    expect(
      timing.mock.calls.some(([target, config]) => target === 0 && (config?.duration ?? 0) > 0),
    ).toBe(true);
  } finally {
    timing.mockRestore();
  }
});
