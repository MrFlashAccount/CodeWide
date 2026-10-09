import { act, fireEvent, render } from "@testing-library/react-native";
import type { NativeSyntheticEvent } from "react-native";
import type { WebViewProps } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";
import { BrowserWorkspaceHost } from "../src/features/browser/BrowserWorkspaceHost";
import { browserPresentation } from "../src/services/browser/browserPresentation";
import { BrowserWorkspace } from "../src/features/browser/BrowserWorkspace";
import { ComposerBrowserContextChip } from "../src/features/browser/ComposerBrowserContextChip";
import { BrowserTabsNavigationContext } from "../src/features/browser/BrowserTabsNavigationContext";
import { BrowserTabsModel } from "../src/services/browser/browserTabsModel";
import { browserTabCatalog } from "../src/services/browser/browserTabCatalog";
import { v1ThreadRouteParams } from "../src/services/threads/threadRouteParams";
import { disposeAllRouteSessions } from "../src/services/routeSessionPolicy";
import { AppFullscreenOverlayProvider } from "../src/ui/AppFullscreenOverlay";

const mockPages = new Map<object, WebViewProps>();
const mockReload = jest.fn();
const mockReadFavicon = jest.fn<Promise<string | null>, [number, string]>(async () => null);

jest.mock("../src/native/browserFavicon", () => ({
  readBrowserFavicon: (target: number, url: string) => mockReadFavicon(target, url),
}));

jest.mock("react-native-webview", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    WebView: React.forwardRef(function Page(props: WebViewProps, ref) {
      const identity = React.useRef({}).current;
      mockPages.set(identity, props);
      React.useImperativeHandle(ref, () => ({
        goBack: jest.fn(),
        goForward: jest.fn(),
        injectJavaScript: jest.fn(),
        reload: mockReload,
        stopLoading: jest.fn(),
      }));
      React.useEffect(
        () => () => {
          mockPages.delete(identity);
        },
        [identity],
      );
      return <View testID="native-browser-page" />;
    }),
  };
});

function nativeEvent<Value>(value: Value): NativeSyntheticEvent<Value> {
  // WHY: The native-event boundary is unavailable in Node; page handlers consume
  // only nativeEvent and preventDefault from this deliberate synthetic fixture.
  return { nativeEvent: value, preventDefault: jest.fn() } as NativeSyntheticEvent<Value>;
}
function navigation(url: string, target = 11): WebViewNavigation {
  return {
    canGoBack: false,
    canGoForward: false,
    loading: false,
    lockIdentifier: 0,
    target,
    title: "Page",
    url,
  };
}
function pageProps() {
  const props = mockPages.values().next().value;
  if (props === undefined) throw new Error("No native page mounted");
  return props;
}
function identity(connectionId: string, threadId: string) {
  const parsed = v1ThreadRouteParams({ connectionId, threadId });
  if (parsed.status === "invalid") throw new Error("Bad test identity");
  return parsed.value;
}
function workspace(tabs: BrowserTabsModel) {
  return render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspace onClose={jest.fn()} tabs={tabs} />
    </AppFullscreenOverlayProvider>,
  );
}
afterEach(() => {
  mockPages.clear();
  mockReload.mockClear();
  mockReadFavicon.mockReset().mockResolvedValue(null);
  disposeAllRouteSessions();
});

it("uses the native loaded favicon in tab chrome and clears it on the next navigation", async () => {
  mockReadFavicon.mockResolvedValue("data:image/png;base64,YQ==");
  const tabs = new BrowserTabsModel();
  const tab = tabs.open({ title: "Example", url: "https://example.com/" });
  const view = workspace(tabs);
  await act(async () => {
    pageProps().onLoadStart?.(nativeEvent(navigation("https://example.com/")));
    pageProps().onNavigationStateChange?.(navigation("https://example.com/"));
  });
  expect(mockReadFavicon).toHaveBeenCalledWith(11, "https://example.com/");
  expect(tab.favicon$.peek()).toBe("data:image/png;base64,YQ==");
  const counter = view.queryByLabelText("Open browser tabs: 1");
  if (counter === null) {
    fireEvent.press(view.getByLabelText("Browser menu"));
    fireEvent.press(view.getByLabelText("Browser menu: Tabs"));
  } else {
    fireEvent.press(counter);
  }
  expect(view.getByTestId("browser-tab-favicon").props.source.uri).toBe(
    "data:image/png;base64,YQ==",
  );
  act(() => pageProps().onLoadStart?.(nativeEvent(navigation("https://other.example/"))));
  expect(tab.favicon$.peek()).toBeNull();
  expect(view.queryByTestId("browser-tab-favicon")).toBeNull();
});

it("opens the exact chat from Browser chip and reflects only its tab count", () => {
  const open = jest.fn();
  const scope = identity("server-a", "chat");
  const tabs = browserTabCatalog.forThread(scope);
  const view = render(
    <BrowserTabsNavigationContext.Provider value={open}>
      <ComposerBrowserContextChip connectionId="server-a" threadId="chat" />
    </BrowserTabsNavigationContext.Provider>,
  );
  expect(view.getByLabelText("Browser: 0 tabs")).toBeTruthy();
  act(() => {
    tabs.open({ title: "Private title", url: "https://example.com/?secret=value" });
  });
  fireEvent.press(view.getByLabelText("Browser: 1 tabs"));
  expect(open).toHaveBeenCalledWith(scope);
  expect(view.queryByText("Private title")).toBeNull();
  view.rerender(
    <BrowserTabsNavigationContext.Provider value={open}>
      <ComposerBrowserContextChip connectionId="server-b" threadId="chat" />
    </BrowserTabsNavigationContext.Provider>,
  );
  expect(view.getByLabelText("Browser: 0 tabs")).toBeTruthy();
});

it("keeps native page identities during selection and closes exactly one tab", () => {
  const tabs = new BrowserTabsModel();
  const first = tabs.open({ title: "First", url: "https://first.example/" });
  const second = tabs.open({ title: "Second", url: "https://second.example/" });
  workspace(tabs);
  const original = Array.from(mockPages.keys());
  act(() => tabs.select(first.id));
  expect(Array.from(mockPages.keys())).toHaveLength(original.length);
  original.forEach((entry, index) => expect(Array.from(mockPages.keys())[index]).toBe(entry));
  act(() => tabs.close(second.id));
  expect(mockPages.size).toBe(1);
  expect(Array.from(mockPages.keys())[0]).toBe(original[0]);
});

it("opens supported URL popups inside the browser without inheriting tunnel headers", () => {
  const tabs = new BrowserTabsModel();
  tabs.open({
    headers: { Authorization: "private-test" },
    title: "Tunnel",
    url: "https://tunnel.example/",
  });
  workspace(tabs);
  const opener = pageProps();
  act(() => opener.onOpenWindow?.(nativeEvent({ targetUrl: "https://other.example/popup" })));
  expect(mockPages.size).toBe(2);
  const child = Array.from(mockPages.values())[1];
  expect(child?.source).toEqual({ uri: "https://other.example/popup" });
  expect(Array.from(mockPages.values())[0]?.source).toEqual({
    headers: { Authorization: "private-test" },
    uri: "https://tunnel.example/",
  });
  const hiddenOpener = pageProps();
  act(() => hiddenOpener.onOpenWindow?.(nativeEvent({ targetUrl: "https://third.example/" })));
  expect(mockPages.size).toBe(2);
});

it("blocks unsupported schemes locally instead of delegating to the OS", () => {
  const tabs = new BrowserTabsModel();
  tabs.open({ title: "Example", url: "https://example.com/" });
  const view = workspace(tabs);
  const page = pageProps();
  expect(page.originWhitelist).toEqual(["*"]);
  act(() => {
    // WHY: Android emits platform-specific fields; this fixture supplies every
    // value consumed by the policy adapter and deliberately omits unused metadata.
    expect(
      page.onShouldStartLoadWithRequest?.({ url: "intent://external" } as Parameters<
        NonNullable<WebViewProps["onShouldStartLoadWithRequest"]>
      >[0]),
    ).toBe(false);
    page.onOpenWindow?.(nativeEvent({ targetUrl: "javascript:alert(1)" }));
  });
  expect(mockPages.size).toBe(1);
  expect(view.getByText("This link is not supported in the browser")).toBeTruthy();
});

it("keeps the page visible without custom loading, network or HTTP error panels and reloads from navigation", () => {
  const tabs = new BrowserTabsModel();
  tabs.open({ title: "Example", url: "https://example.com/" });
  const view = workspace(tabs);
  const page = pageProps();
  const error = nativeEvent({
    ...navigation("https://example.com/"),
    code: -2,
    description: "secret native URL details",
    domain: "network",
  });
  act(() => page.onError?.(error));
  expect(error.preventDefault).toHaveBeenCalled();
  expect(view.queryByTestId("browser-page-feedback")).toBeNull();
  expect(view.queryByText("secret native URL details")).toBeNull();
  expect(page.startInLoadingState).toBeUndefined();
  act(() =>
    page.onHttpError?.(
      nativeEvent({
        ...navigation("https://example.com/"),
        description: "Server error",
        statusCode: 500,
      }),
    ),
  );
  expect(view.queryByText("HTTP 500")).toBeNull();
  fireEvent.press(view.getByLabelText("Reload"));
  expect(mockReload).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("browser-page-feedback")).toBeNull();
});

it("recreates a lost renderer only on retry and ignores events from its discarded native target", () => {
  const tabs = new BrowserTabsModel();
  tabs.open({ title: "Example", url: "https://example.com/" });
  const view = workspace(tabs);
  const retired = pageProps();
  const original = Array.from(mockPages.keys());
  act(() => retired.onRenderProcessGone?.(nativeEvent({ didCrash: true, target: 11 })));
  expect(Array.from(mockPages.keys())).toHaveLength(original.length);
  original.forEach((entry, index) => expect(Array.from(mockPages.keys())[index]).toBe(entry));
  fireEvent.press(view.getByLabelText("Reload"));
  expect(Array.from(mockPages.keys())[0]).not.toBe(original[0]);
  act(() =>
    pageProps().onError?.(
      nativeEvent({
        ...navigation("https://example.com/"),
        code: -2,
        description: "old renderer",
        domain: "network",
      }),
    ),
  );
  expect(view.queryByTestId("browser-page-feedback")).toBeNull();
});

it("shows native loading progress below navigation and clears it on a settled page", () => {
  const tabs = new BrowserTabsModel();
  tabs.open({ title: "Example", url: "https://example.com/" });
  const view = workspace(tabs);
  act(() => {
    pageProps().onNavigationStateChange?.({ ...navigation("https://example.com/"), loading: true });
    pageProps().onLoadProgress?.(
      nativeEvent({ ...navigation("https://example.com/"), progress: 0.47 }),
    );
  });
  expect(view.getByRole("progressbar").props.accessibilityValue.now).toBe(47);
  act(() => pageProps().onNavigationStateChange?.(navigation("https://example.com/")));
  expect(view.queryByRole("progressbar")).toBeNull();
});

it("retains live native pages and selected history across collapse and reopening", () => {
  const scope = identity("server", "chat");
  const tabs = browserTabCatalog.forThread(scope);
  const tab = tabs.open({ title: "Page", url: "https://example.com/start" });
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspaceHost />
    </AppFullscreenOverlayProvider>,
  );
  act(() =>
    browserPresentation.show({ onDismiss: jest.fn(), sessionId: "first", tabs, thread: scope }),
  );
  const nativePage = Array.from(mockPages.keys())[0];
  act(() =>
    pageProps().onNavigationStateChange?.({
      ...navigation("https://example.com/redirect"),
      canGoBack: true,
    }),
  );
  act(() => browserPresentation.hide("first"));
  expect(mockPages.size).toBe(1);
  expect(Array.from(mockPages.keys())[0]).toBe(nativePage);
  expect(
    view.getByTestId("browser-workspace-host", { includeHiddenElements: true }),
  ).not.toBeVisible();
  act(() =>
    browserPresentation.show({ onDismiss: jest.fn(), sessionId: "second", tabs, thread: scope }),
  );
  expect(Array.from(mockPages.keys())[0]).toBe(nativePage);
  expect(pageProps().source).toEqual({ uri: "https://example.com/redirect" });
  expect(view.getByLabelText("Back")).toBeEnabled();
  act(() => tabs.close(tab.id));
  expect(mockPages.size).toBe(0);
});

it("retains other chats' live pages without exposing them in the selected chat", () => {
  const first = identity("server", "first-chat");
  const second = identity("server", "second-chat");
  const a = browserTabCatalog.forThread(first);
  const b = browserTabCatalog.forThread(second);
  a.open({ title: "A", url: "https://a.example/" });
  b.open({ title: "B", url: "https://b.example/" });
  const view = render(
    <AppFullscreenOverlayProvider>
      <BrowserWorkspaceHost />
    </AppFullscreenOverlayProvider>,
  );
  act(() =>
    browserPresentation.show({ onDismiss: jest.fn(), sessionId: "first", tabs: a, thread: first }),
  );
  const nativePage = Array.from(mockPages.keys())[0];
  act(() => browserPresentation.hide("first"));
  act(() =>
    browserPresentation.show({
      onDismiss: jest.fn(),
      sessionId: "second",
      tabs: b,
      thread: second,
    }),
  );
  expect(mockPages.size).toBe(2);
  expect(Array.from(mockPages.keys())[0]).toBe(nativePage);
  expect(view.getByLabelText("Select browser tab: B · b.example")).toBeTruthy();
  expect(view.queryByLabelText("Select browser tab: A · a.example")).toBeNull();
});
