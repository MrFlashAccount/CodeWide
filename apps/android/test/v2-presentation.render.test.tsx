import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Dimensions, Text } from "react-native";

import type { V2ThreadWindow } from "@codewide/sync-client/v2";

import {
  SavedServerWorkspaceView,
  ServerWorkspaceView,
} from "../src/presentation/layouts/AdaptiveWorkspaceView";
import { WorkspaceView } from "../src/presentation/layouts/WorkspaceView";
import { ThreadSidebarView } from "../src/presentation/navigation/ThreadSidebarView";
import { TimelineView } from "../src/presentation/conversation/TimelineView";
import { ConnectionSettingsView } from "../src/presentation/settings/ConnectionSettingsView";
import { timelineDisplayModel } from "../src/v2/features/conversation/timelineDisplayModel";
import { threadListCopy } from "../src/v2/features/threadList/threadListPresentation";

describe("V2 presentation", () => {
  it("keeps a string workspace subtitle on one line like V1", () => {
    render(
      <WorkspaceView subtitle="A subtitle that must not wrap" title="Thread">
        <Text>Conversation</Text>
      </WorkspaceView>,
    );

    const subtitle = screen.getByText("A subtitle that must not wrap");
    expect(subtitle.props.ellipsizeMode).toBe("middle");
    expect(subtitle.props.numberOfLines).toBe(1);
  });

  it("uses the canonical preview when the App Server title is only a placeholder", () => {
    expect(
      threadListCopy({ preview: "Newest canonical answer", title: "Untitled thread" }),
    ).toEqual({
      preview: "Newest canonical answer",
      title: "Newest canonical answer",
    });
  });

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

  it("uses the same wide-layout boundary as V1", () => {
    setWindowSize(840, 800);
    const view = render(
      <ServerWorkspaceView rail={<Text>Boundary rail</Text>}>
        <SavedServerWorkspaceView emptyMain={false} sidebar={<Text>Boundary sidebar</Text>}>
          <Text>Boundary content</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.getByText("Boundary rail")).toBeTruthy();
    expect(screen.getByText("Boundary sidebar")).toBeTruthy();

    setWindowSize(900, 420);
    view.rerender(
      <ServerWorkspaceView rail={<Text>Boundary rail</Text>}>
        <SavedServerWorkspaceView emptyMain={false} sidebar={<Text>Boundary sidebar</Text>}>
          <Text>Boundary content</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.queryByText("Boundary rail")).toBeNull();
    expect(screen.queryByText("Boundary sidebar")).toBeNull();
    expect(screen.getByText("Boundary content")).toBeTruthy();
  });

  it("renders searchable thread navigation with working actions", () => {
    const onNewThread = jest.fn();
    const onOpen = jest.fn();
    render(
      <ThreadSidebarView
        connectionState="live"
        onNewThread={onNewThread}
        onOpen={onOpen}
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

    fireEvent.changeText(screen.getByLabelText("Search threads"), "beta");
    expect(screen.queryByText("Alpha")).toBeNull();
    fireEvent.press(screen.getByText("Beta"));
    expect(onOpen).toHaveBeenCalledWith("thread-b");
    fireEvent.press(screen.getByLabelText("New thread"));
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("keeps messages, lifecycle rows, activities, and terminal status distinct", () => {
    render(
      <TimelineView
        turns={[
          {
            activityCount: 1,
            activities: [
              {
                detail: "$ pnpm test",
                id: "activity",
                label: "Command",
                state: "completed",
              },
            ],
            assistantText: ["Answer"],
            completedAt: "2026-08-31T22:00:03.000Z",
            createdAt: "2026-08-31T22:00:00.000Z",
            durationMs: 3000,
            id: "turn",
            lifecycle: [{ id: "lifecycle", label: "Preparing session" }],
            state: "completed",
            usage: {
              inputTokens: 26_000,
              latestRequestTokens: 25_700,
              modelContextWindow: 258_400,
              outputTokens: 19,
              threadInputTokens: 76_000,
              threadOutputTokens: 1_000,
              threadTotalCostUsd: 0.044,
              threadTotalTokens: 77_000,
              totalCostUsd: 0.014,
            },
            userText: ["Question"],
          },
        ]}
      />,
    );

    expect(screen.getByText("Question")).toBeTruthy();
    expect(screen.getByText("Preparing session")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Expand activity Activity" }));
    expect(screen.getByText("$ pnpm test")).toBeTruthy();
    expect(screen.getByText("Answer")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("preserves the authoritative activity summary when detail items are absent", () => {
    const turns = timelineDisplayModel({
      newerCursor: null,
      olderCursor: null,
      thread: {
        archived: false,
        createdAt: "2026-08-31T22:00:00.000Z",
        headTurnId: "turn",
        id: "thread",
        lastActivityAt: "2026-08-31T22:00:03.000Z",
        parentId: null,
        preview: "Answer",
        settings: null,
        state: "completed",
        title: "Question",
        updatedAt: "2026-08-31T22:00:03.000Z",
        workspace: "/workspace",
      },
      turns: [
        {
          activity: { count: 1, kinds: ["reasoning"] },
          completedAt: "2026-08-31T21:59:59.000Z",
          createdAt: "2026-08-31T21:59:58.000Z",
          durationMs: 1000,
          id: "initial-turn",
          items: [
            { id: "initial-user", kind: "userText", text: "Initial question" },
            { id: "initial-assistant", kind: "assistantText", text: "Initial answer" },
          ],
          state: "completed",
          threadId: "thread",
          usage: {
            inputTokens: 10,
            latestRequestTokens: 10,
            modelContextWindow: 200_000,
            outputTokens: 1,
            threadInputTokens: 10,
            threadOutputTokens: 1,
            threadTotalCostUsd: 0.01,
            threadTotalTokens: 11,
            totalCostUsd: 0.01,
          },
        },
        {
          activity: { count: 2, kinds: ["reasoning", "command"] },
          completedAt: "2026-08-31T22:00:03.000Z",
          createdAt: "2026-08-31T22:00:00.000Z",
          durationMs: 3000,
          id: "turn",
          items: [
            { id: "user", kind: "userText", text: "Question" },
            { id: "assistant", kind: "assistantText", text: "Answer" },
          ],
          state: "completed",
          threadId: "thread",
          usage: null,
        },
      ],
    } satisfies V2ThreadWindow);

    expect(turns[0]?.activityCount).toBe(1);
    expect(turns[0]?.usage?.inputTokens).toBe(10);
    expect(turns[1]?.activityCount).toBe(2);
    render(<TimelineView turns={turns} />);
    expect(screen.getByRole("button", { name: "Expand activity 2 activities · 2" })).toBeTruthy();
    expect(screen.getByText("Answer")).toBeTruthy();
  });

  it("renders the V1 settings sheet composition instead of a standalone settings page", () => {
    const changeAppLock = jest.fn();
    const changeServerEnabled = jest.fn();
    const close = jest.fn();
    render(
      <ConnectionSettingsView
        appLockBusy={false}
        appLockEnabled={false}
        error={null}
        generationControl={<Text>Generation selector</Text>}
        onAppLockChange={changeAppLock}
        onClose={close}
        onServerAction={jest.fn()}
        onServerEnabledChange={changeServerEnabled}
        servers={[
          {
            detail: "wss://buddy.example/v1/sync",
            emoji: "🖥️",
            enabled: true,
            id: "buddy",
            label: "Buddy",
            state: "connected",
          },
        ]}
        version="0.2.98"
      />,
    );

    expect(screen.getByText("Security")).toBeTruthy();
    expect(screen.getByText("Interface")).toBeTruthy();
    expect(screen.getByText("Buddy")).toBeTruthy();
    expect(screen.getByText("wss://buddy.example/v1/sync")).toBeTruthy();
    expect(screen.getByText("Version 0.2.98")).toBeTruthy();
    expect(screen.queryByText("Accounts")).toBeNull();
    fireEvent(screen.getByLabelText("Biometric app lock"), "valueChange", true);
    expect(changeAppLock).toHaveBeenCalledWith(true);
    fireEvent(screen.getByLabelText("Enable Buddy"), "valueChange", false);
    expect(changeServerEnabled).toHaveBeenCalledWith("buddy", false);
    fireEvent.press(screen.getByLabelText("Close server settings"));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

function setWindowWidth(width: number): void {
  setWindowSize(width, 800);
}

function setWindowSize(width: number, height: number): void {
  act(() => {
    Dimensions.set({
      screen: { fontScale: 1, height, scale: 1, width },
      window: { fontScale: 1, height, scale: 1, width },
    });
  });
}
