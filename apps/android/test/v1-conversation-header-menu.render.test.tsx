import { fireEvent, render } from "@testing-library/react-native";
import type { ComponentProps } from "react";

import { ConversationHeader } from "../src/features/conversation/header/ConversationHeader";
import { ActionMenu } from "../src/ui/ActionMenu";
import { AppNoticeProvider } from "../src/ui/AppNotice";

type HeaderProps = ComponentProps<typeof ConversationHeader>;

const thread = {
  id: "thread",
  pinned: false,
  preview: "",
  serverId: "server",
  timestamp: 1,
  title: "Review the parser",
  unread: 0,
};

function renderHeader(overrides: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    accountRateLimitsDatabase: null,
    archived: false,
    closeThreadSearch: jest.fn(),
    compact: true,
    currentUsage: null,
    cwd: "/w",
    deleteThread: async () => undefined,
    dismissComposerKeyboardForOverlay: jest.fn(),
    draftConnectionId: null,
    draftThreadId: null,
    forkOffer: undefined,
    forkPicker: undefined,
    historyActivityModel: null,
    historyActivityResourceId: null,
    newChat: false,
    onArchive: async () => undefined,
    onBack: jest.fn(),
    onCompact: async () => undefined,
    onFork: undefined,
    onRefreshAccountRateLimits: undefined,
    onTogglePin: async () => undefined,
    onUnarchive: undefined,
    openThreadRename: jest.fn(),
    pinned: false,
    readOnly: false,
    remoteThread: null,
    server: undefined,
    sessionCompactionCount: null,
    setThreadSearchVisible: jest.fn(),
    thread,
    threadChatModel: null,
    threadSearchVisible: false,
    ...overrides,
  };
  return {
    props,
    view: render(<ConversationHeader {...props} />, { wrapper: AppNoticeProvider }),
  };
}

function menuActions(view: ReturnType<typeof render>) {
  const menus = view.UNSAFE_getAllByType(ActionMenu);
  expect(menus).toHaveLength(1);
  return (menus[0]?.props.actions ?? []) as readonly {
    readonly description?: string;
    readonly disabled?: boolean;
    readonly label: string;
  }[];
}

const THREAD_ITEMS = [
  "Copy session ID",
  "Rename",
  "Pin thread",
  "Fork thread",
  "Compact context",
  "Archive thread",
  "Delete thread",
];

it("keeps the ordinary thread screen header: back arrow, one menu, no pane close", () => {
  const { props, view } = renderHeader();

  fireEvent.press(view.getByLabelText("Back to threads"));
  expect(props.onBack).toHaveBeenCalledTimes(1);
  expect(menuActions(view).map((action) => action.label)).toEqual(THREAD_ITEMS);
  expect(menuActions(view).find((action) => action.label === "Rename")?.disabled).toBeUndefined();
  expect(view.queryByLabelText("Close review chat")).toBeNull();
  expect(view.getByTestId("conversation-title")).toHaveTextContent("Review the parser");
});

it("shows a read-only thread's menu with reading actions enabled and changes disabled", () => {
  const { view } = renderHeader({
    deleteThread: undefined,
    onArchive: undefined,
    onCompact: undefined,
    onTogglePin: undefined,
    readOnly: true,
  });
  const actions = menuActions(view);

  expect(actions.map((action) => action.label)).toEqual(THREAD_ITEMS);
  expect(actions.find((action) => action.label === "Copy session ID")?.disabled).not.toBe(true);
  for (const label of [
    "Rename",
    "Pin thread",
    "Compact context",
    "Archive thread",
    "Delete thread",
  ]) {
    expect(actions.find((action) => action.label === label)).toMatchObject({
      description: "Read-only thread",
      disabled: true,
    });
  }
  fireEvent.press(view.getByLabelText("Thread menu"));
  expect(view.getByLabelText("Thread menu: Copy session ID")).toBeEnabled();
  expect(view.getByLabelText("Thread menu: Rename")).toBeDisabled();
});

it("presents a pane header: title, one menu with the pane items, and close instead of back", () => {
  const onBack = jest.fn();
  const onFullscreen = jest.fn();
  const { view } = renderHeader({
    onBack,
    presentation: {
      closeLabel: "Close review chat",
      kind: "pane",
      menuItems: [
        { icon: "expand-outline", id: "fullscreen", label: "Fullscreen", onSelect: onFullscreen },
      ],
    },
  });

  expect(view.queryByLabelText("Back to threads")).toBeNull();
  expect(view.getByTestId("conversation-title")).toHaveTextContent("Review the parser");
  expect(menuActions(view).map((action) => action.label)).toEqual(["Fullscreen", ...THREAD_ITEMS]);
  fireEvent.press(view.getByLabelText("Thread menu"));
  fireEvent.press(view.getByLabelText("Thread menu: Fullscreen"));
  expect(onFullscreen).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText("Close review chat"));
  expect(onBack).toHaveBeenCalledTimes(1);
});

it("keeps a new chat without a thread menu", () => {
  const { view } = renderHeader({ newChat: true });
  expect(view.UNSAFE_queryAllByType(ActionMenu)).toHaveLength(0);
});
