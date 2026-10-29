import type { Thread, Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  applyThreadProjectionPatchesImmutable,
  projectedTurnMetadata,
  type ThreadProjectionPatchV1,
} from "@codewide/sync-client";
import { act, fireEvent, render, type RenderResult } from "@testing-library/react-native";
import { View } from "react-native";
import type { BackgroundTaskOutputPage } from "../src/data/backgroundTaskOutput";
import {
  compactCompletedTurnForStorage,
  materializeThreadTurns,
  shouldApplyLiveThreadRow,
  type ThreadDetailRow,
} from "../src/data/thread-detail-projection";
import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../src/features/conversation/conversationRouteNavigation";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { BackgroundTaskOutputHost } from "../src/features/conversation/turns/BackgroundTaskOutputHost";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import {
  VirtualizedTurnLeadItem,
  VirtualizedTurnTimelineItem,
} from "../src/features/conversation/turns/VirtualizedTurnTimelineItem";
import type { TaskOutputRouteRequest } from "../src/services/backgroundTasks/taskOutputRouteSession";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

const LAUNCHED_AT = 1_760_000_000;
const TITLE = "Rerun the Android Preview release";

/** A `commandExecution` item, with the Companion's background marker when it started a task. */
function command(id: string, background: Record<string, unknown> | null) {
  return {
    aggregatedOutput: "Command running in background.",
    command: `./scripts/${id} --with-a-long-argument`,
    commandActions: [],
    cwd: "/workspace",
    durationMs: 10,
    exitCode: 0,
    id,
    processId: null,
    source: "agent",
    status: "completed",
    type: "commandExecution",
    ...(background === null
      ? {}
      : {
          codewideBackgroundTask: { description: null, startedAt: LAUNCHED_AT, ...background },
          codewideBackgroundTaskId: background.taskId,
        }),
  };
}

const prompt = {
  clientId: null,
  content: [{ text: "Release it in the background", text_elements: [], type: "text" }],
  id: "prompt",
  type: "userMessage",
};

function answer(id: string) {
  return {
    delivery: null,
    id,
    memoryCitation: null,
    phase: "final_answer",
    questions: null,
    text: "Started.",
    type: "agentMessage",
  };
}

/** The report Claude delivers when the task ends, as the Companion projects it. */
function report(taskId: string, kind: "agent" | "command", name: string) {
  return {
    agentThreadId: null,
    delivery: "wake",
    durationMs: null,
    id: `report-${taskId}`,
    kind,
    name,
    result: null,
    status: "completed",
    taskId,
    toolUses: null,
    type: "codewideTaskNotification",
  };
}

function completedTurn(id: string, items: readonly unknown[]): Turn {
  const value: unknown = {
    completedAt: 200,
    durationMs: 30_000,
    error: null,
    id,
    items,
    itemsView: "full",
    startedAt: 1,
    status: "completed",
  };
  // WHY: the generated protocol union has no narrow test factory; the fixture
  // supplies only the fields the timeline projection reads.
  return value as Turn;
}

function timelineItem(turn: Turn): TurnItem {
  const value: unknown = {
    connectionId: "server",
    id: turn.id,
    key: `server/thread/${turn.id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn,
  };
  // WHY: the timeline item carries further optional fields the turn rows never read.
  return value as TurnItem;
}

/** The production turn rows of `turns`, as the virtualized timeline draws them. */
function timelineSurface(turns: readonly Turn[]) {
  const rows = projectTimelineRows(turns.map(timelineItem), {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  });
  return (
    <View>
      {rows.map((row) =>
        row.kind === "turnLead" ? (
          <VirtualizedTurnLeadItem
            key={row.key}
            notifications={row.notifications}
            presentation={projectTurnPresentation(row.item, null, false, false)}
            turn={row.item}
          />
        ) : row.kind !== "turnSlice" ? null : (
          <VirtualizedTurnTimelineItem
            animateLiveUpdates={false}
            compact={false}
            followsLead={row.followsLead}
            forceExpanded={false}
            key={row.key}
            parts={row.parts}
            placement={row.placement}
            trailingTasks={row.trailingTasks}
            presentation={projectTurnPresentation(row.item, null, false, false)}
            requestPrompt={null}
            turn={row.item}
          />
        ),
      )}
    </View>
  );
}

/** Lays out the task lines, which size their pill by the line's width. */
function layOut(view: RenderResult) {
  for (const row of view.queryAllByTestId("task-notification-line-row")) {
    fireEvent(row, "layout", { nativeEvent: { layout: { height: 40, width: 600, x: 0, y: 0 } } });
  }
}

function pillLabels(view: RenderResult): string[] {
  return view
    .queryAllByTestId("task-notification-line")
    .map((pill) => String(pill.props.accessibilityLabel));
}

function detailRow(overrides: Partial<ThreadDetailRow>): ThreadDetailRow {
  return {
    activityItems: null,
    connectionId: "server",
    historyEpoch: 0,
    id: "content",
    kind: "turn",
    lastOpenedAt: 0,
    ordinal: 0,
    remoteThreadId: "thread",
    remoteTurnId: "turn",
    sealed: true,
    sessionId: null,
    thread: null,
    turn: null,
    turnMetadata: null,
    ...overrides,
  };
}

/** The Companion's `item/completed` of `item` in turn `turn`, as a semantic patch. */
function itemCompleted(item: unknown): ThreadProjectionPatchV1 {
  const patch: unknown = {
    operation: { item, itemPhase: "completed", kind: "itemUpsert", turnId: "turn" },
    threadId: "thread",
    version: 1,
  };
  // WHY: the patch's operation union is the wire shape the Companion attaches;
  // this fixture supplies exactly the `itemUpsert` fields it carries.
  return patch as ThreadProjectionPatchV1;
}

function navigationRecorder() {
  const opened: TaskOutputRouteRequest[] = [];
  const ignore = (): void => undefined;
  const navigation: ConversationRouteNavigation = {
    openAgents: ignore,
    openAttachments: ignore,
    openChanges: ignore,
    openCodeDocument: ignore,
    openContent: ignore,
    openDocument: ignore,
    openDrawing: ignore,
    openTaskOutput: (request) => {
      opened.push(request);
    },
    openTerminal: ignore,
    openTool: ignore,
    openTurnChanges: ignore,
  };
  return { navigation, opened };
}

beforeEach(() => {
  // Three minutes after the launch.
  jest.spyOn(Date, "now").mockReturnValue((LAUNCHED_AT + 180) * 1000);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it("draws a background command as one pill after its bubble: title, state and time", () => {
  for (const [background, label] of [
    [{ status: "running" }, `${TITLE} running · 3m`],
    [{ endedAt: LAUNCHED_AT + 120, exitCode: 0, status: "completed" }, `${TITLE} 2m`],
    [{ endedAt: LAUNCHED_AT + 30, exitCode: 2, status: "failed" }, `${TITLE} failed · 30.0 s`],
    [{ endedAt: LAUNCHED_AT + 60, status: "stopped" }, `${TITLE} stopped · 1m`],
    // Another provider or an older Companion: ended, neutrally, never "unknown".
    [{ status: "unknown" }, `${TITLE} ended`],
  ] as const) {
    const view = render(
      timelineSurface([
        completedTurn("turn", [
          prompt,
          command("release", { ...background, description: TITLE, taskId: "brelease1" }),
          answer("answer"),
        ]),
      ]),
    );
    layOut(view);
    expect(pillLabels(view)).toEqual([label]);
    view.unmount();
  }
});

it("names a command without a description by its shortened first line", () => {
  const view = render(
    timelineSurface([
      completedTurn("turn", [
        prompt,
        command("release", { status: "running", taskId: "brelease1" }),
        answer("answer"),
      ]),
    ]),
  );
  layOut(view);

  expect(pillLabels(view)).toEqual(["./scripts/release --with-a-long-argument running · 3m"]);
});

it("draws an older Companion's id-only marker as an ended task, never as unknown", () => {
  const legacy = {
    ...command("release", null),
    codewideBackgroundTaskId: "brelease1",
  };
  const view = render(timelineSurface([completedTurn("turn", [prompt, legacy, answer("answer")])]));
  layOut(view);

  expect(pillLabels(view)).toEqual(["./scripts/release --with-a-long-argument ended"]);
  expect(view.queryByText(/unknown/u)).toBeNull();
});

it("draws no pill for a turn whose commands ran in the foreground", () => {
  const view = render(
    timelineSurface([completedTurn("turn", [prompt, command("build", null), answer("answer")])]),
  );
  layOut(view);

  expect(view.queryByTestId("task-notification-line")).toBeNull();
});

it("draws one element per task: the launch pill, not also the command's report", () => {
  const launch = completedTurn("turn", [
    prompt,
    command("release", {
      description: TITLE,
      endedAt: LAUNCHED_AT + 120,
      exitCode: null,
      status: "completed",
      taskId: "brelease1",
    }),
    answer("answer"),
  ]);
  // The task's end woke the agent; an agent's report in the same wake keeps its own line.
  const wake = completedTurn("wake", [
    report("brelease1", "command", TITLE),
    report("a0000000000000001", "agent", "Review the diff"),
    answer("wake-answer"),
  ]);
  const view = render(timelineSurface([launch, wake]));
  layOut(view);

  expect(pillLabels(view)).toEqual([`${TITLE} 2m`, "Review the diff finished"]);
});

it("updates a sealed turn's pill live when the Companion republishes its command", () => {
  const running = command("release", { description: TITLE, status: "running", taskId: "brelease1" });
  // The stored turn is sealed and compacted: its background command stays resident.
  const stored = compactCompletedTurnForStorage(
    completedTurn("turn", [prompt, command("build", null), running, answer("answer")]),
  );
  expect(stored.items.map((item) => item.id)).toEqual(["prompt", "release", "answer"]);
  const content = detailRow({ turn: stored });
  const view = render(timelineSurface([materializeThreadTurns([content])[0] ?? stored]));
  layOut(view);
  expect(pillLabels(view)).toEqual([`${TITLE} running · 3m`]);

  // The task ended after its turn: the same item of the same turn again.
  const ended = command("release", {
    description: TITLE,
    endedAt: LAUNCHED_AT + 60,
    exitCode: 1,
    status: "failed",
    taskId: "brelease1",
  });
  const thread: unknown = { id: "thread", turns: [stored] };
  // WHY: only the fields the patch reducer reads are present in this thread fixture.
  const live = applyThreadProjectionPatchesImmutable(thread as Thread, [itemCompleted(ended)]);
  const liveTurn = live.turns[0];
  const metadata = liveTurn === undefined ? null : projectedTurnMetadata(liveTurn);
  // The sealed content row is never rewritten; the turn's metadata row is.
  expect(shouldApplyLiveThreadRow(content, detailRow({ turn: liveTurn ?? null }))).toBe(false);
  const metadataRow = detailRow({ id: "metadata", kind: "turnMeta", turnMetadata: metadata });
  const updated = materializeThreadTurns([content, metadataRow])[0];
  if (updated === undefined) {
    throw new Error("the turn did not materialize");
  }
  view.rerender(timelineSurface([updated]));
  layOut(view);

  expect(pillLabels(view)).toEqual([`${TITLE} failed · 1m`]);
});

it("opens the task's output when its pill is pressed, and offers nothing without output reads", async () => {
  const turn = completedTurn("turn", [
    prompt,
    command("release", { description: TITLE, status: "running", taskId: "brelease1" }),
    answer("answer"),
  ]);
  const first: BackgroundTaskOutputPage = {
    command: "./scripts/release",
    nextOffset: null,
    sizeBytes: 9,
    status: "running",
    taskId: "brelease1",
    text: "building",
  };
  const read = jest.fn(async () => first);
  const { navigation, opened } = navigationRecorder();
  const readable = render(
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <BackgroundTaskOutputHost read={read}>{timelineSurface([turn])}</BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );
  layOut(readable);
  await act(async () => {
    fireEvent.press(readable.getByTestId("task-notification-line"));
  });
  expect(read).toHaveBeenCalledWith("brelease1", 0);
  expect(opened).toEqual([expect.objectContaining({ first, name: TITLE, taskId: "brelease1" })]);
  readable.unmount();

  const unreadable = render(
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <BackgroundTaskOutputHost read={undefined}>{timelineSurface([turn])}</BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );
  layOut(unreadable);
  expect(unreadable.getByTestId("task-notification-line").props.accessibilityState).toMatchObject({
    disabled: true,
  });
});
