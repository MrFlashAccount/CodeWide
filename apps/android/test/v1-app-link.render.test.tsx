import { fireEvent, render } from "@testing-library/react-native";
import { Text, StyleSheet } from "react-native";
import { ThreadRow } from "../src/features/threadList/ThreadRow";
import { Pressable } from "react-native-gesture-handler";
import { linkTo } from "expo-router/build/global-state/routing";
import { AppLink } from "../src/ui/AppLink";
import { AppNoticeContext } from "../src/ui/appNoticeContext";
import { State } from "react-native-gesture-handler";
import { fireGestureHandler, getByGestureTestId } from "react-native-gesture-handler/jest-utils";

// Exercise Expo's actual href resolution, Slot and native event composition;
// substitute only the router dispatch boundary, which requires a NavigationContainer.
let mockCatalogFocused = false;
jest.mock("expo-router", () => ({
  Link: jest.requireActual("expo-router/build/link/BaseExpoRouterLink").BaseExpoRouterLink,
  useIsFocused: () => mockCatalogFocused,
}));
jest.mock("expo-router/build/global-state/routing", () => ({ linkTo: jest.fn() }));
jest.mock("expo-router/build/Prefetch", () => ({ Prefetch: () => null }));

beforeEach(() => {
  jest.clearAllMocks();
  mockCatalogFocused = false;
});

it.each([false, true])(
  "dispatches one real Link action with dismissTo=%s after child preparation",
  (dismissTo) => {
    const prepare = jest.fn();
    const longPress = jest.fn();
    const view = render(
      <AppLink
        dismissTo={dismissTo}
        href={{
          pathname: "/threads/[connectionId]/[threadId]",
          params: {
            connectionId: "server/with space",
            threadId: "thread?#%",
            projectListSessionId: "project",
          },
        }}
      >
        <Pressable onPress={prepare} onLongPress={longPress} accessibilityLabel="Open thread">
          <Text>Thread</Text>
        </Pressable>
      </AppLink>,
    );
    const row = view.getByRole("link");
    fireEvent(row, "longPress");
    expect(longPress).toHaveBeenCalledTimes(1);
    expect(linkTo).not.toHaveBeenCalled();
    fireEvent.press(row);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(linkTo).toHaveBeenCalledTimes(1);
    expect(linkTo).toHaveBeenCalledWith(
      "/threads/server%2Fwith%20space/thread%3F%23%25?projectListSessionId=project",
      expect.objectContaining({ event: dismissTo ? "POP_TO" : undefined }),
    );
    expect(prepare.mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(linkTo).mock.invocationCallOrder[0],
    );
  },
);

it("retains row geometry and selection styling through the real Link Slot", () => {
  const view = render(
    <AppNoticeContext.Provider value={{ show: jest.fn() }}>
      <ThreadRow
        link={{
          dismissTo: false,
          href: {
            pathname: "/threads/[connectionId]/[threadId]",
            params: { connectionId: "server", threadId: "thread" },
          },
        }}
        onNavigate={jest.fn()}
        selected
        server={undefined}
        thread={{
          id: "thread",
          serverId: "server",
          title: "Thread",
          preview: "",
          pinned: false,
          unread: 0,
        }}
      />
    </AppNoticeContext.Provider>,
  );
  const style = StyleSheet.flatten(view.getByRole("link").props.style);
  expect(style.height).toBeGreaterThan(0);
  expect(style.backgroundColor).toBeTruthy();
});

it.each([true, false])(
  "chooses the link action from catalog focus=%s even with a retained POP_TO link",
  (focused) => {
    mockCatalogFocused = focused;
    const view = render(
      <AppNoticeContext.Provider value={{ show: jest.fn() }}>
        <ThreadRow
          link={{
            dismissTo: true,
            href: {
              pathname: "/threads/[connectionId]/[threadId]",
              params: { connectionId: "server", threadId: "next" },
            },
          }}
          onNavigate={jest.fn()}
          selected={false}
          server={undefined}
          thread={{
            id: "next",
            serverId: "server",
            title: "Next thread",
            preview: "",
            pinned: false,
            unread: 0,
          }}
        />
      </AppNoticeContext.Provider>,
    );
    fireGestureHandler(getByGestureTestId("thread-row-tap"), [{ state: State.END }]);
    expect(linkTo).toHaveBeenCalledWith(
      "/threads/server/next",
      expect.objectContaining({ event: focused ? undefined : "POP_TO" }),
    );
  },
);
