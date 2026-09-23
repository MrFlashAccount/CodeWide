import { act, fireEvent, render, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { View } from "react-native";

import { ThreadRow } from "../src/features/threadList/ThreadRow";
import type { ThreadListItem } from "../src/features/threadList/threadListTypes";
import { AppNoticeContext } from "../src/ui/appNoticeContext";

// WHY: Node cannot compose Android popups. Keep the real row and CodeWideMenu;
// expose only the native host, popup dismissal and menu-item selection boundary.
jest.mock("@expo/ui/jetpack-compose", () => {
  const { View, Text } = jest.requireActual<typeof import("react-native")>("react-native");
  const Container = ({ children }: { children?: ReactNode }) => <View>{children}</View>;
  const Host = ({ children }: { children?: ReactNode }) => (
    <View testID="compose-host">{children}</View>
  );
  const Popup = ({
    children,
    onDismissRequest,
  }: {
    children?: ReactNode;
    onDismissRequest(): void;
  }) => (
    <View testID="native-popup" onTouchCancel={onDismissRequest}>
      {children}
    </View>
  );
  const Item = ({
    children,
    onClick,
    enabled,
  }: {
    children?: ReactNode;
    onClick(): void;
    enabled: boolean;
  }) => (
    <View
      accessible
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: !enabled }}
      onTouchEnd={onClick}
    >
      {children}
    </View>
  );
  return {
    Host,
    Column: Container,
    RNHostView: Container,
    HorizontalDivider: Container,
    Icon: Container,
    Text,
    DropdownMenu: Object.assign(Popup, { Trigger: Container, Items: Container }),
    DropdownMenuItem: Object.assign(Item, {
      Text: Container,
      LeadingIcon: Container,
      TrailingIcon: Container,
    }),
  };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: jest.fn(),
  height: jest.fn(),
  padding: jest.fn(),
}));

type Measure = (x: number, y: number, width: number, height: number) => void;
let pendingMeasure: Measure | undefined;
let deferMeasure = false;
const node = {
  measureInWindow(callback: Measure) {
    if (deferMeasure) {
      pendingMeasure = callback;
    } else {
      callback(12, 180, 360, 64);
    }
  },
};

const thread: ThreadListItem = {
  id: "first",
  serverId: "server",
  title: "First chat",
  preview: "Preview",
  pinned: false,
  unread: 0,
};
const press = jest.fn();
const pin = jest.fn(async () => undefined);
function row(item = thread, onPin = pin) {
  return (
    <AppNoticeContext.Provider value={{ show: jest.fn() }}>
      <ThreadRow
        link={{
          dismissTo: false,
          href: {
            pathname: "/threads/[connectionId]/[threadId]",
            params: { connectionId: "server", threadId: "first" },
          },
        }}
        onNavigate={press}
        onTogglePin={onPin}
        selected={false}
        server={undefined}
        thread={item}
      />
    </AppNoticeContext.Provider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(View.prototype, "measureInWindow").mockImplementation(node.measureInWindow);
  pendingMeasure = undefined;
  deferMeasure = false;
});

it("mounts no Compose hosts or popup items for idle rows, including overscan", () => {
  const view = render(
    <AppNoticeContext.Provider value={{ show: jest.fn() }}>
      <View>
        {Array.from({ length: 24 }, (_, index) => (
          <ThreadRow
            key={index}
            link={{
              dismissTo: false,
              href: {
                pathname: "/threads/[connectionId]/[threadId]",
                params: { connectionId: "server", threadId: "first" },
              },
            }}
            onNavigate={press}
            selected={false}
            server={undefined}
            thread={{ ...thread, id: String(index) }}
          />
        ))}
      </View>
    </AppNoticeContext.Provider>,
  );
  // The idle-row native-host budget is zero regardless of the virtualizer's pool size.
  expect(view.queryAllByTestId("compose-host")).toHaveLength(0);
  expect(view.queryAllByRole("menuitem")).toHaveLength(0);
});

it("opens from the real row, preserves its instance, selects and removes the popup", () => {
  const view = render(row());
  const trigger = view.getByRole("link", { name: "Thread actions" });
  fireEvent.press(trigger);
  expect(press).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("compose-host")).toBeNull();
  fireEvent(trigger, "longPress");
  expect(view.getAllByTestId("compose-host")).toHaveLength(1);
  expect(view.getByRole("link", { name: "Thread actions" })).toBe(trigger);
  fireEvent.press(within(view.getByTestId("native-popup")).getByRole("menuitem", { name: "Pin" }));
  expect(pin).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("compose-host")).toBeNull();
  expect(view.getByRole("link", { name: "Thread actions" })).toBe(trigger);
});

it("honors disabled actions and native dismissal without dispatching", () => {
  const view = render(row());
  fireEvent(view.getByRole("link", { name: "Thread actions" }), "longPress");
  fireEvent.press(view.getByRole("menuitem", { name: "Mark as read" }));
  expect(view.getByTestId("native-popup")).toBeTruthy();
  fireEvent(view.getByTestId("native-popup"), "touchCancel");
  expect(view.queryByTestId("compose-host")).toBeNull();
  expect(pin).not.toHaveBeenCalled();
});

it("discards an open menu when the virtualizer reuses a row for another thread", () => {
  const secondPin = jest.fn(async () => undefined);
  const view = render(row());
  fireEvent(view.getByRole("link", { name: "Thread actions" }), "longPress");
  const staleItem = view.getByRole("menuitem", { name: "Pin" });
  view.rerender(row({ ...thread, id: "second", title: "Second chat" }, secondPin));
  expect(view.queryByTestId("compose-host")).toBeNull();
  view.rerender(row());
  expect(view.queryByTestId("compose-host")).toBeNull();
  expect(secondPin).not.toHaveBeenCalled();
  // A retired native popup must not dispatch after the row has been rebound.
  act(() => {
    fireEvent.press(staleItem);
  });
  expect(pin).not.toHaveBeenCalled();
});

it("ignores delayed measurements after row recycling or unmount", () => {
  deferMeasure = true;
  const view = render(row());
  fireEvent(view.getByRole("link", { name: "Thread actions" }), "longPress");
  const firstMeasure = pendingMeasure;
  expect(firstMeasure).toBeDefined();
  view.rerender(row({ ...thread, id: "second" }));
  act(() => {
    firstMeasure?.(0, 0, 360, 64);
  });
  expect(view.queryByTestId("compose-host")).toBeNull();
  fireEvent(view.getByRole("link", { name: "Thread actions" }), "longPress");
  const secondMeasure = pendingMeasure;
  view.unmount();
  act(() => {
    secondMeasure?.(0, 0, 360, 64);
  });
  expect(pin).not.toHaveBeenCalled();
});
