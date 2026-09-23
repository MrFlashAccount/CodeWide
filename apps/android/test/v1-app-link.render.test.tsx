import { fireEvent, render } from "@testing-library/react-native";
import { Text, StyleSheet } from "react-native";
import { ThreadRow } from "../src/features/threadList/ThreadRow";
import { Pressable } from "react-native-gesture-handler";
import { linkTo } from "expo-router/build/global-state/routing";
import { AppLink } from "../src/ui/AppLink";
import { AppNoticeContext } from "../src/ui/appNoticeContext";

// Exercise Expo's actual href resolution, Slot and native event composition;
// substitute only the router dispatch boundary, which requires a NavigationContainer.
jest.mock("expo-router", () => ({
  Link: jest.requireActual("expo-router/build/link/BaseExpoRouterLink").BaseExpoRouterLink,
}));
jest.mock("expo-router/build/global-state/routing", () => ({ linkTo: jest.fn() }));
jest.mock("expo-router/build/Prefetch", () => ({ Prefetch: () => null }));

beforeEach(() => jest.clearAllMocks());

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
