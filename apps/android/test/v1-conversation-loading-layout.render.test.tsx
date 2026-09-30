import { act, cleanup, fireEvent, render } from "@testing-library/react-native";
import { useEffect, useState, type ReactElement } from "react";
import { Text, View } from "react-native";

import { COMPLETE_STATIC_THREAD_HISTORY } from "../src/data/use-thread-history-controller";
import { ConversationBottomChrome } from "../src/features/conversation/ConversationBottomChrome";
import { ConversationComposerSlot } from "../src/features/conversation/ConversationComposerSlot";
import { ConversationEmptyState } from "../src/features/conversation/ConversationEmptyState";
import { ConversationLayout } from "../src/features/conversation/ConversationLayout";
import { ConversationTimelineSurface } from "../src/features/conversation/timeline/ConversationTimelineSurface";
import {
  conversationBottomContentInset,
  conversationTopContentInset,
} from "../src/ui/conversation-chrome-layout";
import type { MessageListState } from "../src/ui/MessageListBoundary";

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

function Timeline({
  bottomChromeHeight = 0,
  bottomChromeMeasured = true,
  children = <View testID="ready-timeline" />,
  liveStatusVisible = false,
  scope = "server/thread",
  state,
  threadSearchVisible = false,
  timelineModelReady = state.status === "ready",
  timelinePositioned = state.status === "ready",
}: {
  bottomChromeHeight?: number;
  bottomChromeMeasured?: boolean;
  children?: ReactElement;
  liveStatusVisible?: boolean;
  scope?: string;
  state: MessageListState;
  threadSearchVisible?: boolean;
  timelineModelReady?: boolean;
  timelinePositioned?: boolean;
}) {
  return (
    <ConversationTimelineSurface
      awayFromLatest={false}
      bottomChromeHeight={bottomChromeHeight}
      bottomChromeMeasured={bottomChromeMeasured}
      commitUnreadReceipt={() => () => undefined}
      composerScope={scope}
      draftConnectionId={null}
      draftThreadId={null}
      fullscreenCovered={false}
      goalContent={null}
      historyActivityModel={null}
      historyActivityResourceId={null}
      historyViewport={COMPLETE_STATIC_THREAD_HISTORY}
      latestUnreadReceiptKey={null}
      liveStatusVisible={liveStatusVisible}
      liveTurnPlan={null}
      messageListState={state}
      positionSearchTurn={() => undefined}
      readOnly={false}
      remoteThread={null}
      threadSearchActive={false}
      threadSearchVisible={threadSearchVisible}
      timeline={[]}
      timelineContent={children}
      timelineDidLoad={false}
      timelineGestureActive={false}
      timelineModelReady={timelineModelReady}
      timelinePositioned={timelinePositioned}
      timelineViewportRef={{ current: null }}
    />
  );
}

it("keeps one mounted conversation layout while timeline and composer become ready", () => {
  const headerMounted = jest.fn();
  const headerUnmounted = jest.fn();
  function Header() {
    useEffect(() => {
      headerMounted();
      return headerUnmounted;
    }, []);
    return <Text testID="canonical-conversation-title">Chat title</Text>;
  }
  function Screen({ loading }: { loading: boolean }) {
    return (
      <ConversationLayout
        bottomChrome={
          <ConversationComposerSlot
            state={
              loading
                ? { status: "loading" }
                : {
                    status: "ready",
                    value: {
                      attachments: [],
                      connectionId: "server",
                      draftText: "",
                      id: "server\u0000thread",
                      preferences: null,
                      scrollOffset: null,
                      threadId: "thread",
                      updatedAt: 1,
                    },
                  }
            }
          >
            <View testID="ready-composer" />
          </ConversationComposerSlot>
        }
        compact={false}
        conversationInsets={{ bottom: 0, left: 0, right: 0, top: 0 }}
        cwd="/workspace"
        headerContent={<Header />}
        jumpContent={<View />}
        openCodeDocument={jest.fn()}
        presentTurnChanges={jest.fn()}
        projectPickerContent={<View />}
        projectPickerVisible={false}
        renameContent={<View />}
        reviewContent={<View />}
        searchContent={<View />}
        setComposerTrayVisible={jest.fn()}
        setConversationPaneHeight={jest.fn()}
        setNarrowConversationPane={jest.fn()}
        threadRenameVisible={false}
        threadSearchVisible={false}
        timelineSurface={<Timeline state={{ status: loading ? "loading" : "ready" }} />}
      />
    );
  }
  const view = render(<Screen loading />);

  expect(view.getByTestId("thread-detail-pane-shell")).toBeTruthy();
  expect(view.getByTestId("canonical-conversation-title").props.children).toBe("Chat title");
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  expect(view.getByTestId("composer-loading-placeholder")).toBeTruthy();

  act(() => jest.advanceTimersByTime(200));
  expect(view.getByTestId("message-list-skeleton")).toBeVisible();

  view.rerender(<Screen loading={false} />);

  expect(view.getByTestId("thread-detail-pane-shell")).toBeTruthy();
  expect(view.getByTestId("canonical-conversation-title").props.children).toBe("Chat title");
  expect(view.getByTestId("ready-timeline")).toBeTruthy();
  expect(view.getByTestId("ready-composer")).toBeTruthy();
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  expect(view.queryByTestId("composer-loading-placeholder")).toBeNull();
  expect(headerMounted).toHaveBeenCalledTimes(1);
  expect(headerUnmounted).not.toHaveBeenCalled();
});

it("prepares a nonempty timeline invisibly and reveals it as soon as positioning completes", () => {
  const view = render(
    <Timeline state={{ status: "ready" }} timelineModelReady timelinePositioned={false} />,
  );

  expect(view.getByTestId("ready-timeline", { includeHiddenElements: true })).not.toBeVisible();
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  act(() => jest.advanceTimersByTime(7));
  view.rerender(<Timeline state={{ status: "ready" }} timelineModelReady timelinePositioned />);

  expect(view.getByTestId("ready-timeline")).toBeVisible();
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  act(() => jest.advanceTimersByTime(500));
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
});

it("waits for the measured composer before mounting a nonempty timeline for positioning", () => {
  const view = render(
    <Timeline
      bottomChromeMeasured={false}
      state={{ status: "ready" }}
      timelineModelReady
      timelinePositioned={false}
    />,
  );

  expect(view.queryByTestId("ready-timeline", { includeHiddenElements: true })).toBeNull();

  view.rerender(
    <Timeline
      bottomChromeHeight={96}
      bottomChromeMeasured
      state={{ status: "ready" }}
      timelineModelReady
      timelinePositioned={false}
    />,
  );

  expect(view.getByTestId("ready-timeline", { includeHiddenElements: true })).not.toBeVisible();
});

it("does not hide an already positioned timeline during a later model loading state", () => {
  const view = render(<Timeline state={{ status: "ready" }} />);
  expect(view.getByTestId("ready-timeline")).toBeVisible();

  view.rerender(
    <Timeline state={{ status: "loading" }} timelineModelReady={false} timelinePositioned />,
  );

  expect(view.getByTestId("ready-timeline")).toBeVisible();
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  expect(jest.getTimerCount()).toBe(0);
});

it("keeps draft, loading existing, and confirmed empty thread states distinct", () => {
  const props = {
    cwd: "/workspace",
    historyActivityModel: null,
    historyActivityResourceId: null,
    onChangeWorkspaceMode: undefined,
    openProjectPicker: jest.fn(),
    threadSearchActive: false,
    workspaceMode: "current" as const,
    workspaceSupport: null,
  };
  const draftView = render(<ConversationEmptyState {...props} newChat />);

  expect(draftView.getByText("What would you like to work on?")).toBeTruthy();
  expect(draftView.getByLabelText("Change project, currently workspace")).toBeTruthy();
  draftView.unmount();

  const loadingView = render(
    <Timeline state={{ status: "loading" }}>
      <ConversationEmptyState {...props} newChat={false} />
    </Timeline>,
  );
  expect(loadingView.queryByTestId("message-list-skeleton")).toBeNull();
  expect(loadingView.queryByText("Start by typing a message")).toBeNull();
  act(() => jest.advanceTimersByTime(200));
  expect(loadingView.getByTestId("message-list-skeleton")).toBeTruthy();
  expect(loadingView.queryByText("What would you like to work on?")).toBeNull();
  expect(loadingView.queryByText("Start by typing a message")).toBeNull();
  loadingView.unmount();

  const emptyView = render(<ConversationEmptyState {...props} newChat={false} />);
  expect(emptyView.queryByText("What would you like to work on?")).toBeNull();
  expect(emptyView.getByText("Start by typing a message")).toBeTruthy();
});

it("reserves the measured composer and header space while loading, including geometry changes", () => {
  function LoadingScreen({
    searchVisible,
    liveStatusVisible,
  }: {
    searchVisible: boolean;
    liveStatusVisible: boolean;
  }) {
    const [bottomChromeHeight, setBottomChromeHeight] = useState(0);
    const reportBottomChromeHeight = (height: number) => {
      setBottomChromeHeight(Math.ceil(height));
    };
    return (
      <View>
        <Timeline
          bottomChromeHeight={bottomChromeHeight}
          liveStatusVisible={liveStatusVisible}
          state={{ status: "loading" }}
          threadSearchVisible={searchVisible}
        />
        <ConversationBottomChrome
          composerContent={<View testID="ready-composer" />}
          currentOutcome={null}
          failureNotice={null}
          readOnly
          reportBottomChromeHeight={reportBottomChromeHeight}
          remoteThread={null}
          requestPrompt={null}
          timeline={[]}
        />
      </View>
    );
  }
  const view = render(<LoadingScreen liveStatusVisible={false} searchVisible={false} />);
  fireEvent(view.getByTestId("conversation-bottom-chrome"), "layout", {
    nativeEvent: { layout: { height: 126.4, width: 400, x: 0, y: 650 } },
  });
  act(() => jest.advanceTimersByTime(200));

  expect(view.getByTestId("message-list-skeleton")).toHaveStyle({
    paddingBottom: conversationBottomContentInset(127, false),
    paddingTop: conversationTopContentInset(false),
  });

  // The restored draft/attachments can make the real composer taller than its placeholder.
  fireEvent(view.getByTestId("conversation-bottom-chrome"), "layout", {
    nativeEvent: { layout: { height: 234, width: 400, x: 0, y: 550 } },
  });
  view.rerender(<LoadingScreen liveStatusVisible searchVisible />);
  expect(view.getByTestId("message-list-skeleton")).toHaveStyle({
    paddingBottom: conversationBottomContentInset(234, true),
    paddingTop: conversationTopContentInset(true),
  });
});

it("resets only the pending skeleton on direct chat switches", () => {
  const view = render(<Timeline scope="chat-a" state={{ status: "loading" }} />);
  act(() => jest.advanceTimersByTime(200));
  expect(view.getByTestId("message-list-skeleton")).toBeVisible();

  view.rerender(<Timeline scope="chat-b" state={{ status: "loading" }} />);
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
  act(() => jest.advanceTimersByTime(40));
  view.rerender(<Timeline scope="chat-b" state={{ status: "ready" }} />);
  expect(view.getByTestId("ready-timeline")).toBeVisible();
  act(() => jest.advanceTimersByTime(500));
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
});

it("keeps an immediate load error and its retry action clear of the composer", () => {
  const view = render(
    <Timeline
      bottomChromeHeight={144}
      state={{ status: "error", message: "History unavailable", retry: async () => undefined }}
    />,
  );

  expect(view.getByRole("alert")).toHaveTextContent("History unavailable");
  expect(view.getByRole("button", { name: "Retry loading messages" })).toBeVisible();
  expect(view.getByTestId("message-list-error")).toHaveStyle({
    paddingBottom: conversationBottomContentInset(144, false),
    paddingTop: conversationTopContentInset(false),
  });
  expect(view.queryByTestId("message-list-skeleton")).toBeNull();
});
