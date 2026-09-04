import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { StyleSheet, type View } from "react-native";

import { TimelineView } from "../src/v2/presentation/conversation/TimelineView";
import { TimelineActivityContent } from "../src/v2/presentation/conversation/timelineActivityContent";
import { messageActionRequest } from "../src/v2/presentation/conversation/MessageActionRailView";
import { V2RenderingCapabilityProvider } from "../src/v2/rendering/renderingCapabilities";
import type { TimelineDisplayTurn } from "../src/v2/presentation/conversation/timelineTypes";
import {
  isAssistantVisible,
  useLatestAssistantVisibility,
} from "../src/v2/presentation/conversation/timelineVisibility";
import { useTimelineViewport } from "../src/v2/presentation/conversation/timelineViewport";

interface TimelineViewportHarnessInput {
  canLoadNewer: boolean;
  turns: TimelineDisplayTurn[];
}

describe("V2 timeline interactions", () => {
  it("renders lazily loaded commentary, activity, and final text in authoritative order", async () => {
    const interleaved = turn("interleaved");
    interleaved.activityCount = 1;
    interleaved.assistantText = ["First commentary", "Final answer"];
    const commentary = {
      id: "commentary",
      kind: "assistant" as const,
      memoryCitation: null,
      text: "First commentary",
    };
    const command = {
      activity: {
        command: "inspect",
        cwd: "/workspace",
        durationMs: 1,
        exitCode: 0,
        id: "command",
        kind: "command" as const,
        label: "Command",
        output: "Command output",
        state: "completed" as const,
      },
      id: "command",
      kind: "activity" as const,
    };
    const final = {
      id: "final",
      kind: "assistant" as const,
      memoryCitation: null,
      text: "Final answer",
    };
    interleaved.responseRows = [commentary, final];
    const loadActivity = jest.fn(async () => [commentary, command, final]);
    const rendered = render(<TimelineView onLoadActivity={loadActivity} turns={[interleaved]} />);
    await act(async () => fireEvent.press(screen.getByLabelText("Expand activity Activity")));
    expect(await screen.findByText("Command output")).toBeTruthy();
    const tree = JSON.stringify(rendered.toJSON());

    expect(tree.indexOf("First commentary")).toBeLessThan(tree.indexOf("Command output"));
    expect(tree.indexOf("Command output")).toBeLessThan(tree.indexOf("Final answer"));
  });

  it("does not repeat pre-turn lifecycle rows after lazy activity expansion", async () => {
    const lifecycleTurn = turn("lifecycle");
    lifecycleTurn.activityCount = 1;
    lifecycleTurn.lifecycle = [
      {
        command: "prepare",
        cwd: "/workspace",
        durationMs: null,
        exitCode: 0,
        id: "prepare",
        kind: "command",
        label: "Preparing session",
        output: "Prepared once",
        state: "completed",
      },
    ];
    const loadActivity = jest.fn(async () => [
      {
        activity: {
          command: "prepare",
          cwd: "/workspace",
          durationMs: null,
          exitCode: 0,
          id: "prepare",
          kind: "command",
          label: "Preparing session",
          output: "Prepared once",
          state: "completed",
        },
        id: "prepare",
        kind: "activity",
      },
      {
        activity: {
          command: "inspect",
          cwd: "/workspace",
          durationMs: null,
          exitCode: 0,
          id: "inspect",
          kind: "command",
          label: "Command",
          output: "Inspected",
          state: "completed",
        },
        id: "inspect",
        kind: "activity",
      },
    ]);
    render(<TimelineView onLoadActivity={loadActivity} turns={[lifecycleTurn]} />);
    await act(async () => fireEvent.press(screen.getByLabelText("Expand activity Activity")));

    expect(await screen.findByText("Inspected")).toBeTruthy();
    expect(screen.getAllByText("Prepared once")).toHaveLength(1);
  });

  it("renders memory citations without dropping source lines or thread identities", () => {
    const citedTurn = turn("cited");
    citedTurn.responseRows = [
      {
        id: "cited-assistant",
        kind: "assistant",
        memoryCitation: {
          entries: [{ lineEnd: 12, lineStart: 10, note: "Reconnect rule", path: "MEMORY.md" }],
          threadIds: ["source-thread"],
        },
        text: "cited",
      },
    ];

    render(<TimelineView turns={[citedTurn]} />);

    expect(screen.getByText("MEMORY.md:10–12")).toBeTruthy();
    expect(screen.getByText("Reconnect rule")).toBeTruthy();
    expect(screen.getByText("Source threads · source-thread")).toBeTruthy();
  });

  it("does not fabricate a sent time when the authoritative turn has no timestamp", () => {
    const undated = turn("undated");
    undated.createdAt = null;

    render(<TimelineView turns={[undated]} />);

    expect(screen.queryByText(/^Sent ·/u)).toBeNull();
  });

  it("renders one full-width date separator for each local calendar day", () => {
    const first = turn("first-day-a");
    first.createdAt = "2024-01-02T10:00:00Z";
    const second = turn("first-day-b");
    second.createdAt = "2024-01-02T12:00:00Z";
    const third = turn("second-day");
    third.createdAt = "2024-01-03T12:00:00Z";

    render(<TimelineView turns={[first, second, third]} />);

    const separators = screen.getAllByTestId("timeline-date-separator");
    expect(separators).toHaveLength(2);
    expect(StyleSheet.flatten(separators[0]?.props.style)).toMatchObject({ width: "100%" });
  });

  it("stretches a copyable code block across the agent bubble", () => {
    render(<TimelineView turns={[turn("code", "completed", ["```ts\nconst value = 1;\n```"])]} />);

    expect(StyleSheet.flatten(screen.getByTestId("codex-bubble").props.style)).toMatchObject({
      flexShrink: 0,
      width: "88%",
    });
  });

  it("stretches a Markdown table across the agent bubble", () => {
    render(
      <TimelineView
        turns={[turn("table", "completed", ["| First | Second |\n| --- | --- |\n| A | B |"])]}
      />,
    );

    expect(StyleSheet.flatten(screen.getByTestId("codex-bubble").props.style)).toMatchObject({
      flexShrink: 0,
      width: "88%",
    });
  });

  it("keeps historical image sources opaque to public Markdown loading", () => {
    const resolveImageSource = jest.fn(async () => ({ uri: "content://private/generated.png" }));
    render(
      <V2RenderingCapabilityProvider capabilities={{ resolveImageSource }}>
        <TimelineActivityContent
          activity={{
            id: "generated",
            kind: "imageGeneration",
            label: "Generated image",
            prompt: "A diagram",
            result: "https://example.test/transient.png",
            savedPath: "/tmp/generated.png",
            sourceUrl: "/v2/files/preview?path=%2Ftmp%2Fgenerated%2Epng",
            state: "completed",
          }}
          turnId="turn-a"
        />
      </V2RenderingCapabilityProvider>,
    );

    expect(
      screen.getByText(
        "![Generated image](codewide-private-image:%2Fv2%2Ffiles%2Fpreview%3Fpath%3D%252Ftmp%252Fgenerated%252Epng)",
      ),
    ).toBeTruthy();
    expect(resolveImageSource).not.toHaveBeenCalled();
    expect(screen.getByText("/tmp/generated.png")).toBeTruthy();
    expect(screen.queryByText("https://example.test/transient.png")).toBeNull();
  });

  it("renders bounded unsupported payloads with explicit recovery actions", async () => {
    const copy = jest.fn(async () => undefined);
    const fix = jest.fn(async () => undefined);
    const payloadJson = '{\n  "detail": "unknown wire item"\n}';
    render(
      <TimelineActivityContent
        actions={{ onCopyUnsupported: copy, onFixUnsupported: fix }}
        activity={{
          id: "unsupported",
          kind: "unsupported",
          label: "futureItem",
          payloadJson,
          payloadTruncated: true,
          sourceKind: "futureItem",
          state: "completed",
        }}
        turnId="turn-a"
      />,
    );

    expect(screen.getByText("Unsupported activity · futureItem")).toBeTruthy();
    expect(screen.getByText("Sensitive or oversized fields were removed.")).toBeTruthy();
    expect(screen.getByText(payloadJson)).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByLabelText("Copy unsupported item")));
    await act(async () =>
      fireEvent.press(screen.getByLabelText("Fix unsupported item in new thread")),
    );
    expect(copy).toHaveBeenCalledWith(payloadJson);
    expect(fix).toHaveBeenCalledWith("futureItem", payloadJson);
  });

  it("renders and opens authoritative user media, skills, and mentions", async () => {
    const openAttachment = jest.fn(async () => undefined);
    const richTurn = turn("rich-user-input");
    richTurn.userInput = [
      { kind: "text", text: "Prompt text", textElements: [] },
      {
        attachment: {
          downloadUrl: "/v2/files/preview?path=image.png",
          id: "image",
          mediaType: "image/png",
          name: "image.png",
          sizeBytes: "42",
        },
        detail: "high",
        kind: "localImage",
        reference: "/workspace/image.png",
      },
      {
        attachment: {
          downloadUrl: "/v2/files/preview?path=audio.wav",
          id: "audio",
          mediaType: "audio/wav",
          name: "audio.wav",
          sizeBytes: "84",
        },
        kind: "localAudio",
        reference: "/workspace/audio.wav",
      },
      { kind: "skill", name: "review", path: "/skills/review/SKILL.md" },
      {
        attachment: null,
        kind: "mention",
        name: "Demo App",
        path: "app://demo",
        reference: "app://demo",
      },
      {
        attachment: {
          downloadUrl: "/v2/files/preview?path=recording.mp4",
          id: "video",
          mediaType: "video/mp4",
          name: "recording.mp4",
          sizeBytes: "126",
        },
        kind: "mention",
        name: "recording.mp4",
        path: "/workspace/recording.mp4",
        reference: "/workspace/recording.mp4",
      },
      {
        attachment: {
          downloadUrl: "/v2/files/preview?path=report.pdf",
          id: "document",
          mediaType: "application/pdf",
          name: "report.pdf",
          sizeBytes: "168",
        },
        kind: "mention",
        name: "report.pdf",
        path: "/workspace/report.pdf",
        reference: "/workspace/report.pdf",
      },
    ];
    richTurn.userText = ["Prompt text"];
    render(
      <TimelineView activityActions={{ onOpenAttachment: openAttachment }} turns={[richTurn]} />,
    );
    await act(async () => undefined);

    expect(screen.getByText("Prompt text")).toBeTruthy();
    expect(screen.getByText("Skill · review")).toBeTruthy();
    expect(screen.getByText("Demo App")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Open attachment image.png" }));
      fireEvent.press(screen.getByRole("button", { name: "Open attachment audio.wav" }));
      fireEvent.press(screen.getByRole("button", { name: "Open attachment recording.mp4" }));
      fireEvent.press(screen.getByRole("button", { name: "Open attachment report.pdf" }));
    });
    expect(openAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "image", name: "image.png" }),
    );
    expect(openAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "audio", name: "audio.wav" }),
    );
    expect(openAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "video", name: "recording.mp4" }),
    );
    expect(openAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ id: "document", name: "report.pdf" }),
    );
  });

  it("restores a durable turn anchor and reports a new anchor only while away from the tail", () => {
    const onAnchorTurnChange = jest.fn();
    render(
      <TimelineView
        initialAnchorTurnId="two"
        onAnchorTurnChange={onAnchorTurnChange}
        turns={[turn("one"), turn("two"), turn("three")]}
      />,
    );
    const timeline = screen.getByTestId("conversation-timeline");
    expect(timeline.props.initialScrollIndex).toEqual({
      index: 1,
      viewOffset: 0,
      viewPosition: 0,
    });

    fireEvent.scroll(timeline, {
      nativeEvent: {
        contentOffset: { y: 100 },
        contentSize: { height: 1000, width: 400 },
        layoutMeasurement: { height: 400, width: 400 },
      },
    });
    fireEvent(timeline, "viewableItemsChanged", {
      changed: [],
      end: 1,
      endBuffered: 1,
      start: 0,
      startBuffered: 0,
      viewableItems: [
        { containerId: 1, index: 0, isViewable: true, item: turn("one"), key: "one" },
      ],
    });

    expect(onAnchorTurnChange).toHaveBeenLastCalledWith("one", -100);
  });

  it("restores a variable-height row at its exact saved viewport offset", () => {
    const tallTurn = turn("two");
    tallTurn.userText = ["line\n".repeat(200)];
    render(
      <TimelineView
        initialAnchorOffsetPx={-173.5}
        initialAnchorTurnId="two"
        turns={[turn("one"), tallTurn, turn("three")]}
      />,
    );

    expect(screen.getByTestId("conversation-timeline").props.initialScrollIndex).toEqual({
      index: 1,
      viewOffset: -173.5,
      viewPosition: 0,
    });
  });

  it("shows a new-turn badge while away and clears it after jumping to the tail", async () => {
    const view = render(<TimelineView turns={[turn("one")]} />);
    fireEvent.scroll(screen.getByTestId("conversation-timeline"), {
      nativeEvent: {
        contentOffset: { y: 0 },
        contentSize: { height: 1000, width: 400 },
        layoutMeasurement: { height: 400, width: 400 },
      },
    });
    view.rerender(<TimelineView turns={[turn("one"), turn("two")]} />);

    const jump = screen.getByLabelText("Jump to latest, 1 new turns");
    await act(async () => fireEvent.press(jump));
    expect(screen.queryByTestId("jump-to-latest")).toBeNull();
  });

  it("uses a direct authoritative tail reset instead of paging through newer history", async () => {
    const jumpToLatest = jest.fn(async () => "authoritative-tail");
    const loadNewer = jest.fn(async () => undefined);
    render(
      <TimelineView
        canLoadNewer
        onJumpToLatest={jumpToLatest}
        onLoadNewer={loadNewer}
        turns={[turn("historical")]}
      />,
    );

    await act(async () => fireEvent.press(screen.getByTestId("jump-to-latest")));

    expect(jumpToLatest).toHaveBeenCalledTimes(1);
    expect(loadNewer).not.toHaveBeenCalled();
  });

  it("uses the returned authoritative tail as the unseen baseline after a jump", async () => {
    const listRef = { current: { scrollToEnd: jest.fn(async () => undefined) } };
    const jumpToLatest = jest.fn(async () => "three");
    const { rerender, result } = renderHook(
      (input: TimelineViewportHarnessInput) =>
        useTimelineViewport({
          canLoadNewer: input.canLoadNewer,
          canLoadOlder: false,
          listRef,
          onJumpToLatest: jumpToLatest,
          turns: input.turns,
          unreadCount: 0,
        }),
      { initialProps: { canLoadNewer: true, turns: [turn("one"), turn("two")] } },
    );

    await act(async () => result.current.jumpToLatest());
    rerender({ canLoadNewer: false, turns: [turn("two"), turn("three")] });

    expect(result.current.unseenCount).toBe(0);
  });

  it("deduplicates edge loading and settles only after the loaded layout is available", async () => {
    let resolveLoad: (() => void) | undefined;
    const loadOlder = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const settle = jest.fn();
    render(
      <TimelineView
        canLoadOlder
        onLoadOlder={loadOlder}
        onSettleWindow={settle}
        turns={[turn("one")]}
      />,
    );
    const timeline = screen.getByTestId("conversation-timeline");

    fireEvent(timeline, "startReached");
    fireEvent(timeline, "startReached");
    expect(loadOlder).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loading messages…")).toBeTruthy();
    await act(async () => resolveLoad?.());
    expect(settle).not.toHaveBeenCalled();
    fireEvent(timeline, "contentSizeChange", 400, 1200);
    expect(settle).toHaveBeenCalledWith("older");
  });

  it("preserves every typed action when opening a turn action menu", () => {
    const onEdit = jest.fn();
    const onFork = jest.fn(async () => undefined);
    const onInterrupt = jest.fn(async () => undefined);
    const onReview = jest.fn();
    const onRollback = jest.fn(async () => undefined);

    expect(
      messageActionRequest("Response", {
        onEdit,
        onFork,
        onInterrupt,
        onReview,
        onRollback,
      }),
    ).toEqual({ copyText: "Response", onEdit, onFork, onInterrupt, onReview, onRollback });
  });

  it("shows an edge failure and retries from the same boundary", async () => {
    const loadOlder = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    render(<TimelineView canLoadOlder onLoadOlder={loadOlder} turns={[turn("one")]} />);
    const timeline = screen.getByTestId("conversation-timeline");

    fireEvent(timeline, "startReached");
    await screen.findByText("Could not load messages. Tap to retry.");
    await act(async () => fireEvent.press(screen.getByLabelText("Retry loading older messages")));

    expect(loadOlder).toHaveBeenCalledTimes(2);
  });

  it("releases the edge lock when a loader throws before returning a promise", async () => {
    const loadOlder = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error("synchronous adapter failure");
      })
      .mockResolvedValue(undefined);
    render(<TimelineView canLoadOlder onLoadOlder={loadOlder} turns={[turn("one")]} />);
    const timeline = screen.getByTestId("conversation-timeline");

    fireEvent(timeline, "startReached");
    await screen.findByText("Could not load messages. Tap to retry.");
    await act(async () => fireEvent.press(screen.getByLabelText("Retry loading older messages")));

    expect(loadOlder).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Could not load messages. Tap to retry.")).toBeNull();
  });

  it("releases the direct tail-reset lock after failure and preserves a retry", async () => {
    const jumpToLatest = jest
      .fn<() => Promise<string | null>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce("authoritative-tail");
    render(
      <TimelineView canLoadNewer onJumpToLatest={jumpToLatest} turns={[turn("historical")]} />,
    );

    await act(async () => fireEvent.press(screen.getByTestId("jump-to-latest")));
    expect(await screen.findByText("Could not load messages. Tap to retry.")).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId("jump-to-latest")));

    expect(jumpToLatest).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Could not load messages. Tap to retry.")).toBeNull();
  });

  it("keeps turn actions reachable before the first streamed response", () => {
    render(
      <TimelineView
        actionsForTurn={() => ({ onInterrupt: async () => undefined })}
        turns={[turn("running", "running", [])]}
      />,
    );

    expect(screen.getByLabelText("Message actions")).toBeTruthy();
    expect(screen.queryByTestId("codex-bubble")).toBeNull();
  });

  it("wires visibility tracking only to the latest final assistant response", async () => {
    const markVisible = jest.fn(async () => undefined);
    render(
      <TimelineView
        latestActivityMarker="activity:42"
        onLatestFinalAssistantVisible={markVisible}
        turns={[turn("one"), turn("two")]}
      />,
    );

    fireEvent(screen.getByTestId("conversation-timeline"), "viewableItemsChanged", {
      changed: [],
      end: 1,
      endBuffered: 1,
      start: 1,
      startBuffered: 1,
      viewableItems: [
        { containerId: 1, index: 1, isViewable: true, item: turn("two"), key: "two" },
      ],
    });
    await act(async () => undefined);

    expect(screen.getByTestId("conversation-timeline").props.viewabilityConfig).toEqual({
      itemVisiblePercentThreshold: 1,
    });
    expect(markVisible).not.toHaveBeenCalled();
  });

  it("requires 30 percent of the assistant response itself to be visible", () => {
    expect(isAssistantVisible(70, 100, 0, 100)).toBe(true);
    expect(isAssistantVisible(71, 100, 0, 100)).toBe(false);
  });

  it("reports the exact activity marker after measuring the assistant response", async () => {
    const markVisible = jest.fn(async () => undefined);
    const frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { result } = renderHook(() =>
      useLatestAssistantVisibility({
        activityMarker: "activity:42",
        onVisible: markVisible,
        turns: [turn("one"), turn("two")],
      }),
    );
    await act(async () => {
      result.current.setViewportNode(measuredView(0, 0, 400, 100));
      result.current.setLatestAssistantNode(measuredView(0, 70, 400, 100));
    });

    expect(markVisible).toHaveBeenCalledWith("activity:42");
    frame.mockRestore();
  });

  it("retries a failed read receipt after authority rebinds without another visibility event", async () => {
    const markVisible = jest
      .fn<(marker: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("connection closed"))
      .mockResolvedValue(undefined);
    const frame = jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const { result } = renderHook(() =>
      useLatestAssistantVisibility({
        activityMarker: "activity:42",
        onVisible: markVisible,
        turns: [turn("one"), turn("two")],
      }),
    );
    const assistant = measuredView(0, 70, 400, 100);
    await act(async () => {
      result.current.setViewportNode(measuredView(0, 0, 400, 100));
      result.current.setLatestAssistantNode(assistant);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(markVisible).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.setLatestAssistantNode(null);
      result.current.setLatestAssistantNode(assistant);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(markVisible).toHaveBeenCalledTimes(2);
    expect(markVisible).toHaveBeenLastCalledWith("activity:42");
    frame.mockRestore();
  });

  it("does not mark the authoritative tail read while rendering historical pages", async () => {
    const markVisible = jest.fn(async () => undefined);
    render(
      <TimelineView
        canLoadNewer
        latestActivityMarker="activity:tail"
        onLatestFinalAssistantVisible={markVisible}
        turns={[turn("historical")]}
      />,
    );

    fireEvent(screen.getByTestId("conversation-timeline"), "viewableItemsChanged", {
      changed: [],
      end: 0,
      endBuffered: 0,
      start: 0,
      startBuffered: 0,
      viewableItems: [
        {
          containerId: 1,
          index: 0,
          isViewable: true,
          item: turn("historical"),
          key: "historical",
        },
      ],
    });
    await act(async () => undefined);

    expect(markVisible).not.toHaveBeenCalled();
  });
});

function turn(
  id: string,
  state: TimelineDisplayTurn["state"] = "completed",
  assistantText: string[] = [id],
): TimelineDisplayTurn {
  return {
    activityCount: 0,
    activities: [],
    assistantText,
    completedAt: state === "completed" ? "2026-09-03T00:00:01Z" : null,
    createdAt: "2026-09-03T00:00:00Z",
    durationMs: state === "completed" ? 1000 : null,
    id,
    lifecycle: [],
    responseRows: assistantText.map((text, index) => ({
      id: `${id}-assistant-${index}`,
      kind: "assistant" as const,
      memoryCitation: null,
      text,
    })),
    state,
    usage: null,
    userInput: [{ kind: "text", text: "Question", textElements: [] }],
    userText: ["Question"],
  };
}

function measuredView(x: number, y: number, width: number, height: number): View {
  return {
    measureInWindow(callback: (x: number, y: number, width: number, height: number) => void) {
      callback(x, y, width, height);
    },
  } as unknown as View;
}
