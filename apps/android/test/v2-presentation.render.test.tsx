import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, Text } from "react-native";

import {
  SavedServerWorkspaceView,
  ServerWorkspaceView,
} from "../src/presentation/layouts/AdaptiveWorkspaceView";
import { ThreadSidebarView } from "../src/presentation/navigation/ThreadSidebarView";
import { TimelineView } from "../src/presentation/conversation/TimelineView";

describe("V2 presentation", () => {
  it("composes rail, thread sidebar, and routed content on a wide device", () => {
    setWindowWidth(1_200);
    render(
      <ServerWorkspaceView rail={<Text>Server rail</Text>}>
        <SavedServerWorkspaceView emptyMain={false} sidebar={<Text>Thread sidebar</Text>}>
          <Text>Conversation route</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.getByText("Server rail")).toBeTruthy();
    expect(screen.getByText("Thread sidebar")).toBeTruthy();
    expect(screen.getByText("Conversation route")).toBeTruthy();
  });

  it("keeps only routed content on a narrow device", () => {
    setWindowWidth(420);
    render(
      <ServerWorkspaceView rail={<Text>Hidden server rail</Text>}>
        <SavedServerWorkspaceView emptyMain={false} sidebar={<Text>Hidden thread sidebar</Text>}>
          <Text>Mobile route</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.queryByText("Hidden server rail")).toBeNull();
    expect(screen.queryByText("Hidden thread sidebar")).toBeNull();
    expect(screen.getByText("Mobile route")).toBeTruthy();
  });

  it("renders searchable thread navigation with working actions", () => {
    const onNewThread = jest.fn();
    const onOpen = jest.fn();
    render(
      <ThreadSidebarView
        connectionState="live"
        onNewThread={onNewThread}
        onOpen={onOpen}
        onSettings={jest.fn()}
        rows={[
          {
            id: "thread-a",
            preview: "/workspace/a",
            retained: false,
            state: "running",
            title: "Alpha",
            updatedAt: "10:00",
          },
          {
            id: "thread-b",
            preview: "/workspace/b",
            retained: true,
            state: "completed",
            title: "Beta",
            updatedAt: "09:00",
          },
        ]}
        selectedId="thread-a"
        title="Buddy"
      />,
    );

    fireEvent.changeText(screen.getByLabelText("Search V2 threads"), "beta");
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.press(screen.getByText("Beta"));
    expect(onOpen).toHaveBeenCalledWith("thread-b");
    fireEvent.press(screen.getByLabelText("New thread"));
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("keeps messages, lifecycle rows, activities, and terminal status distinct", () => {
    render(
      <TimelineView
        rows={[
          { id: "user", kind: "user", text: "Question" },
          { id: "lifecycle", kind: "lifecycle", label: "Preparing session" },
          {
            detail: "$ pnpm test",
            id: "activity",
            kind: "activity",
            label: "Command",
            state: "completed",
          },
          { id: "assistant", kind: "assistant", text: "Answer" },
          { id: "status", kind: "status", state: "completed" },
        ]}
      />,
    );

    expect(screen.getByText("Question")).toBeTruthy();
    expect(screen.getByText("Preparing session")).toBeTruthy();
    expect(screen.getByText("$ pnpm test")).toBeTruthy();
    expect(screen.getByText("Answer")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });
});

function setWindowWidth(width: number): void {
  Dimensions.set({
    screen: { fontScale: 1, height: 800, scale: 1, width },
    window: { fontScale: 1, height: 800, scale: 1, width },
  });
}
