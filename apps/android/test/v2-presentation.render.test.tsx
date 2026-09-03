import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";

import type { V2ThreadWindow } from "@codewide/sync-client/v2";

import {
  SavedServerWorkspaceView,
  ServerWorkspaceView,
} from "../src/v2/presentation/layouts/AdaptiveWorkspaceView";
import { WorkspaceView } from "../src/v2/presentation/layouts/WorkspaceView";
import { ThreadSidebarView } from "../src/v2/presentation/navigation/ThreadSidebarView";
import { ServerRailView } from "../src/v2/presentation/navigation/ServerRailView";
import { TimelineView } from "../src/v2/presentation/conversation/TimelineView";
import { ConnectionSettingsView } from "../src/v2/presentation/settings/ConnectionSettingsView";
import { timelineDisplayModel } from "../src/v2/features/conversation/timelineDisplayModel";
import { threadListCopy } from "../src/v2/features/threadList/threadListPresentation";
import { AgentsWorkspace } from "../src/v2/features/agents/AgentsWorkspace";
import { ComposerContextStripView } from "../src/v2/presentation/input/ComposerContextStripView";

describe("V2 presentation", () => {
  it("routes a control chip through its own menu instead of the generic thread action", () => {
    const open = jest.fn();
    const select = jest.fn();
    render(
      <ComposerContextStripView
        items={[
          {
            id: "model",
            label: "GPT-5.6 · high",
            menu: {
              accessibilityLabel: "Model and thinking: GPT-5.6, high",
              actions: [{ id: "effort:xhigh", label: "Extra high" }],
              onSelect: select,
            },
          },
        ]}
        onOpen={open}
      />,
    );

    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6, high"));
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6, high: Extra high"));

    expect(select).toHaveBeenCalledWith("effort:xhigh");
    expect(open).not.toHaveBeenCalled();
  });

  it("never shrinks composer context chips below their label width", () => {
    render(
      <ComposerContextStripView
        items={[{ id: "long", label: "A context label that must remain complete" }]}
        onOpen={() => undefined}
      />,
    );

    const chip = screen.getByLabelText("A context label that must remain complete");
    expect(StyleSheet.flatten(chip.props.style)).toEqual(
      expect.objectContaining({ flexGrow: 0, flexShrink: 0 }),
    );
    expect(screen.getByText("A context label that must remain complete").props.numberOfLines).toBe(
      1,
    );
  });

  it("keeps menu-backed composer chips intrinsically sized too", () => {
    render(
      <ComposerContextStripView
        items={[
          {
            id: "long-menu",
            label: "A selected model name that is wider than the phone",
            menu: {
              accessibilityLabel: "Choose the selected model",
              actions: [],
              onSelect: () => undefined,
            },
          },
        ]}
        onOpen={() => undefined}
      />,
    );

    const intrinsicMenuWrappers = screen.UNSAFE_getAllByType(View).filter((view) => {
      const style = StyleSheet.flatten(view.props.style);
      return style?.alignSelf === "flex-start" && style.flexGrow === 0 && style.flexShrink === 0;
    });
    expect(intrinsicMenuWrappers).not.toHaveLength(0);
    expect(
      screen.getByText("A selected model name that is wider than the phone", {
        includeHiddenElements: true,
      }).props.numberOfLines,
    ).toBe(1);
  });

  it("does not clip an intrinsic loading chip through the shared shimmer bounds", () => {
    render(
      <ComposerContextStripView
        items={[
          {
            id: "loading",
            label: "A loading model name that is wider than the phone",
            loading: true,
          },
        ]}
        onOpen={() => undefined}
      />,
    );

    const shimmerStyle = StyleSheet.flatten(screen.getByTestId("v2-progress-shimmer").props.style);
    expect(shimmerStyle).toEqual(expect.objectContaining({ flexGrow: 0, flexShrink: 0 }));
    expect(shimmerStyle.maxWidth).toBeUndefined();
    expect(shimmerStyle.overflow).toBeUndefined();
  });

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
        <SavedServerWorkspaceView sidebar={<Text>Thread sidebar</Text>}>
          <Text>Conversation route</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.getByText("Server rail")).toBeTruthy();
    expect(screen.getByText("Thread sidebar")).toBeTruthy();
    expect(screen.getByText("Conversation route")).toBeTruthy();
  });

  it("exposes each authoritative connection state from the wide server rail", () => {
    render(
      <ServerRailView
        onOpen={() => undefined}
        rows={[
          { detail: "Connecting", emoji: "1", id: "connecting", label: "First" },
          { detail: "Updating", emoji: "2", id: "updating", label: "Second" },
          { detail: "Offline", emoji: "3", id: "offline", label: "Third" },
          { detail: "Connection error", emoji: "4", id: "error", label: "Fourth" },
        ]}
      />,
    );

    expect(screen.getByLabelText("First, Connecting")).toBeTruthy();
    expect(screen.getByLabelText("Second, Updating")).toBeTruthy();
    expect(screen.getByLabelText("Third, Offline")).toBeTruthy();
    expect(screen.getByLabelText("Fourth, Connection error")).toBeTruthy();
  });

  it("keeps only routed content on a narrow device", () => {
    setWindowWidth(420);
    render(
      <ServerWorkspaceView rail={<Text>Hidden server rail</Text>}>
        <SavedServerWorkspaceView sidebar={<Text>Hidden thread sidebar</Text>}>
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
        <SavedServerWorkspaceView sidebar={<Text>Boundary sidebar</Text>}>
          <Text>Boundary content</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.getByText("Boundary rail")).toBeTruthy();
    expect(screen.getByText("Boundary sidebar")).toBeTruthy();

    setWindowSize(900, 420);
    view.rerender(
      <ServerWorkspaceView rail={<Text>Boundary rail</Text>}>
        <SavedServerWorkspaceView sidebar={<Text>Boundary sidebar</Text>}>
          <Text>Boundary content</Text>
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>,
    );

    expect(screen.queryByText("Boundary rail")).toBeNull();
    expect(screen.queryByText("Boundary sidebar")).toBeNull();
    expect(screen.getByText("Boundary content")).toBeTruthy();
  });

  it("keeps the active route instance across the foldable layout boundary", () => {
    setWindowSize(900, 800);
    const view = render(<StatefulWorkspace modalOpen={false} />);

    fireEvent.press(screen.getByLabelText("Advance route state"));
    expect(screen.getByText("Route state 1")).toBeTruthy();

    setWindowSize(900, 420);
    view.rerender(<StatefulWorkspace modalOpen={false} />);

    expect(screen.getByText("Route state 1")).toBeTruthy();
    expect(screen.queryByText("Stateful rail")).toBeNull();
    expect(screen.queryByText("Stateful sidebar")).toBeNull();
  });

  it("retains the workspace route while a transparent modal owns the foreground", () => {
    setWindowSize(1_200, 800);
    const view = render(<StatefulWorkspace modalOpen={false} />);

    fireEvent.press(screen.getByLabelText("Advance route state"));
    view.rerender(<StatefulWorkspace modalOpen />);

    expect(screen.getByText("Route state 1")).toBeTruthy();
    expect(screen.getByText("Server settings modal")).toBeTruthy();
  });

  it("renders searchable thread navigation with working actions", async () => {
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
    fireEvent.press(await screen.findByText("Beta"));
    expect(onOpen).toHaveBeenCalledWith("thread-b");
    fireEvent.press(screen.getByLabelText("New thread"));
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("renders a running thread title as shimmer text instead of a progress icon", () => {
    render(
      <ThreadSidebarView
        connectionState="live"
        onNewThread={() => undefined}
        onOpen={() => undefined}
        rows={[
          {
            id: "thread-running",
            retained: false,
            state: "running",
            title: "Active work",
            updatedAt: "10:00",
          },
        ]}
        title="Buddy"
      />,
    );

    expect(screen.getByTestId("v2-progress-shimmer").props.accessibilityLabel).toBe("Active work");
    expect(screen.queryByTestId("activity-indicator")).toBeNull();
  });

  it("does not render a server logo inside a chat row", () => {
    render(
      <ThreadSidebarView
        connectionState="live"
        onNewThread={() => undefined}
        onOpen={() => undefined}
        rows={[
          {
            emoji: "🖥️",
            id: "thread-with-server-logo",
            retained: false,
            state: "completed",
            title: "Chat without server chrome",
            updatedAt: "10:00",
          },
        ]}
        title="All threads"
      />,
    );

    expect(screen.queryByText("🖥️")).toBeNull();
  });

  it("keeps the copied V1 subagent workspace shell inside V2", () => {
    setWindowWidth(420);
    const close = jest.fn();
    const select = jest.fn();
    render(
      <AgentsWorkspace
        actionable
        detail={null}
        onClose={close}
        onSelect={select}
        rows={[
          {
            active: true,
            id: "agent-a",
            subtitle: "running · /workspace",
            time: "10:00",
            title: "Researcher",
          },
        ]}
        selectedId={null}
        statusMessage={null}
      />,
    );

    expect(screen.getByText("Subagents")).toBeTruthy();
    expect(screen.getByText("1 · newest activity first")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Back to conversation"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps retained subagent rows visible but non-actionable", () => {
    setWindowWidth(420);
    const select = jest.fn();
    render(
      <AgentsWorkspace
        actionable={false}
        detail={null}
        onClose={() => undefined}
        onSelect={select}
        rows={[
          {
            active: true,
            id: "stale-agent",
            subtitle: "running · /workspace",
            time: "10:00",
            title: "Stale researcher",
          },
        ]}
        selectedId={null}
        statusMessage="Refreshing agents…"
      />,
    );

    const row = screen.getByLabelText("Open subagent Stale researcher");
    expect(row.props.accessibilityState).toEqual({ disabled: true, selected: false });
    fireEvent.press(row);
    expect(select).not.toHaveBeenCalled();
    expect(screen.getByText("Refreshing agents…")).toBeTruthy();
  });

  it("keeps messages, lifecycle rows, activities, and terminal status distinct", () => {
    render(
      <TimelineView
        turns={[
          {
            activityCount: 1,
            activities: [
              {
                command: "pnpm test",
                cwd: "/workspace",
                durationMs: 1000,
                exitCode: 0,
                id: "activity",
                kind: "command",
                label: "Command",
                output: "$ pnpm test",
                state: "completed",
              },
            ],
            assistantText: ["Answer"],
            completedAt: "2026-08-31T22:00:03.000Z",
            createdAt: "2026-08-31T22:00:00.000Z",
            durationMs: 3000,
            id: "turn",
            lifecycle: [
              {
                appContext: null,
                argumentsJson: null,
                durationMs: null,
                error: null,
                id: "lifecycle",
                kind: "tool",
                label: "Preparing session",
                name: "Preparing session",
                pluginId: null,
                readOnlyHint: null,
                resultJson: null,
                server: null,
                state: "completed",
                success: null,
                summary: "",
              },
            ],
            responseRows: [
              {
                id: "activity",
                kind: "activity",
                activity: {
                  command: "pnpm test",
                  cwd: "/workspace",
                  durationMs: 1000,
                  exitCode: 0,
                  id: "activity",
                  kind: "command",
                  label: "Command",
                  output: "$ pnpm test",
                  state: "completed",
                },
              },
              { id: "answer", kind: "assistant", memoryCitation: null, text: "Answer" },
            ],
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
            userInput: [{ kind: "text", text: "Question", textElements: [] }],
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
    expect(within(screen.getByTestId("pre-turn-lifecycle")).getByText("Completed")).toBeTruthy();
    expect(within(screen.getByLabelText("Command, Completed")).getByText("Completed")).toBeTruthy();
    expect(within(screen.getByTestId("turn-footer")).getByText("Completed")).toBeTruthy();
  });

  it("keeps the locale-aware sent time on one line beside a narrower user bubble", () => {
    const formatter = jest.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("16:45");
    render(
      <TimelineView
        turns={[
          {
            activityCount: 0,
            activities: [],
            assistantText: ["Answer"],
            completedAt: "2026-08-31T22:00:03.000Z",
            createdAt: "2026-08-31T22:00:00.000Z",
            durationMs: 3000,
            id: "locale-turn",
            lifecycle: [],
            responseRows: [
              { id: "answer", kind: "assistant", memoryCitation: null, text: "Answer" },
            ],
            state: "completed",
            usage: null,
            userInput: [{ kind: "text", text: "Question", textElements: [] }],
            userText: ["Question"],
          },
        ]}
      />,
    );

    const sentTime = screen.getByText("Sent · 16:45");
    expect(sentTime.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(sentTime.props.style)).toEqual(
      expect.objectContaining({ flexShrink: 0 }),
    );
    expect(StyleSheet.flatten(screen.getByTestId("user-bubble").props.style)).toEqual(
      expect.objectContaining({ maxWidth: "78%" }),
    );
    expect(formatter).toHaveBeenCalledWith(undefined, { hour: "numeric", minute: "2-digit" });
    formatter.mockRestore();
  });

  it("renders active timeline state as shimmer text without a status dot", () => {
    render(
      <TimelineView
        turns={[
          {
            activityCount: 0,
            activities: [],
            assistantText: [],
            completedAt: null,
            createdAt: "2026-08-31T22:00:00.000Z",
            durationMs: null,
            id: "running-turn",
            lifecycle: [
              {
                appContext: null,
                argumentsJson: null,
                durationMs: null,
                error: null,
                id: "preparing",
                kind: "tool",
                label: "Preparing session",
                name: "Preparing session",
                pluginId: null,
                readOnlyHint: null,
                resultJson: null,
                server: null,
                state: "running",
                success: null,
                summary: "",
              },
            ],
            responseRows: [],
            state: "running",
            usage: null,
            userInput: [{ kind: "text", text: "Question", textElements: [] }],
            userText: ["Question"],
          },
        ]}
      />,
    );

    expect(screen.getAllByTestId("v2-progress-shimmer")).toHaveLength(2);
    expect(screen.getByLabelText("Preparing session")).toBeTruthy();
    expect(screen.getByLabelText("Running")).toBeTruthy();
  });

  it("renders the conversation through a tail-anchored LegendList", () => {
    render(
      <TimelineView
        timelineKey="thread-1"
        turns={[
          {
            activityCount: 0,
            activities: [],
            assistantText: ["Answer"],
            completedAt: "2026-08-31T22:00:03.000Z",
            createdAt: "2026-08-31T22:00:00.000Z",
            durationMs: 3000,
            id: "turn",
            lifecycle: [],
            responseRows: [
              { id: "answer", kind: "assistant", memoryCitation: null, text: "Answer" },
            ],
            state: "completed",
            usage: null,
            userInput: [{ kind: "text", text: "Question", textElements: [] }],
            userText: ["Question"],
          },
        ]}
      />,
    );

    const timeline = screen.getByTestId("conversation-timeline");
    expect(timeline.props.initialScrollAtEnd).toBe(true);
    expect(timeline.props.maintainVisibleContentPosition).toEqual({ data: true, size: true });
    expect(timeline.props.recycleItems).toBe(false);
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
        readState: {
          kind: "read",
          latestActivityMarker: null,
          readThroughMarker: null,
          unreadCount: 0,
        },
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
            {
              clientId: null,
              content: [{ kind: "text", text: "Initial question", textElements: [] }],
              id: "initial-user",
              kind: "userMessage",
            },
            { id: "initial-assistant", kind: "assistantText", text: "Initial answer" },
          ],
          lifecycle: [],
          state: "completed",
          threadId: "thread",
          usage: {
            cachedInputTokens: 0,
            cacheHit: null,
            cacheWriteInputTokens: 0,
            inputTokens: 10,
            latestRequestTokens: 10,
            model: "gpt-5.6",
            modelContextWindow: 200_000,
            outputTokens: 1,
            reasoningOutputTokens: 0,
            status: "final",
            threadCachedInputTokens: 0,
            threadCacheWriteInputTokens: 0,
            threadCompactionCount: 0,
            threadInputTokens: 10,
            threadOutputTokens: 1,
            threadReasoningOutputTokens: 0,
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
            {
              clientId: null,
              content: [{ kind: "text", text: "Question", textElements: [] }],
              id: "user",
              kind: "userMessage",
            },
            { id: "assistant", kind: "assistantText", text: "Answer" },
          ],
          lifecycle: [],
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

  it("loads completed turn activity only when the summary is expanded", async () => {
    const loadActivity = jest.fn(async () => [
      {
        id: "command",
        kind: "activity" as const,
        activity: {
          command: "pnpm test",
          cwd: "/workspace",
          durationMs: null,
          exitCode: 0,
          id: "command",
          kind: "command" as const,
          label: "Command",
          output: "$ pnpm test",
          state: "completed" as const,
        },
      },
    ]);
    render(
      <TimelineView
        onLoadActivity={loadActivity}
        turns={[
          {
            activityCount: 1,
            activities: [],
            assistantText: ["Answer"],
            completedAt: "2026-08-31T22:00:03.000Z",
            createdAt: "2026-08-31T22:00:00.000Z",
            durationMs: 3000,
            id: "turn",
            lifecycle: [],
            responseRows: [
              { id: "answer", kind: "assistant", memoryCitation: null, text: "Answer" },
            ],
            state: "completed",
            usage: null,
            userInput: [{ kind: "text", text: "Question", textElements: [] }],
            userText: ["Question"],
          },
        ]}
      />,
    );

    expect(loadActivity).not.toHaveBeenCalled();
    fireEvent.press(screen.getByRole("button", { name: "Expand activity Activity" }));
    expect(await screen.findByText("$ pnpm test")).toBeTruthy();
    expect(loadActivity).toHaveBeenCalledWith("turn");
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
            diagnostic: null,
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

interface StatefulWorkspaceProps {
  modalOpen: boolean;
}

function StatefulWorkspace(props: StatefulWorkspaceProps): React.JSX.Element {
  const { modalOpen } = props;
  return (
    <View>
      <ServerWorkspaceView rail={<Text>Stateful rail</Text>}>
        <SavedServerWorkspaceView sidebar={<Text>Stateful sidebar</Text>}>
          <StatefulRoute />
        </SavedServerWorkspaceView>
      </ServerWorkspaceView>
      {modalOpen ? <Text>Server settings modal</Text> : null}
    </View>
  );
}

function StatefulRoute(): React.JSX.Element {
  const [step, setStep] = useState(0);
  return (
    <Pressable
      accessibilityLabel="Advance route state"
      onPress={() => setStep((value) => value + 1)}
    >
      <Text>{`Route state ${step}`}</Text>
    </Pressable>
  );
}

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
