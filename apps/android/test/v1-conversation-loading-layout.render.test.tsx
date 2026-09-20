import { render } from "@testing-library/react-native";
import { useEffect } from "react";
import { Text, View } from "react-native";

import { ConversationComposerSlot } from "../src/features/conversation/ConversationComposerSlot";
import { ConversationEmptyState } from "../src/features/conversation/ConversationEmptyState";
import { ConversationLayout } from "../src/features/conversation/ConversationLayout";
import { MessageListBoundary } from "../src/ui/MessageListBoundary";

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
        awayFromLatest={false}
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
        conversationBackdropVisible={false}
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
        timelineSurface={
          <MessageListBoundary state={{ status: loading ? "loading" : "ready" }}>
            <View testID="ready-timeline" />
          </MessageListBoundary>
        }
      />
    );
  }
  const view = render(<Screen loading />);

  expect(view.getByTestId("thread-detail-pane-shell")).toBeTruthy();
  expect(view.getByTestId("canonical-conversation-title").props.children).toBe("Chat title");
  expect(view.getByTestId("message-list-skeleton")).toBeTruthy();
  expect(view.getByTestId("composer-loading-placeholder")).toBeTruthy();

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
    <MessageListBoundary state={{ status: "loading" }}>
      <ConversationEmptyState {...props} newChat={false} />
    </MessageListBoundary>,
  );
  expect(loadingView.getByTestId("message-list-skeleton")).toBeTruthy();
  expect(loadingView.queryByText("What would you like to work on?")).toBeNull();
  expect(loadingView.queryByText("Start by typing a message")).toBeNull();
  loadingView.unmount();

  const emptyView = render(<ConversationEmptyState {...props} newChat={false} />);
  expect(emptyView.queryByText("What would you like to work on?")).toBeNull();
  expect(emptyView.getByText("Start by typing a message")).toBeTruthy();
});
