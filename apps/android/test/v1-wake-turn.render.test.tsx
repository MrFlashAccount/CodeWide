import { fireEvent, render, within, type RenderResult } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import {
  VirtualizedTurnLeadItem,
  VirtualizedTurnTimelineItem,
} from "../src/features/conversation/turns/VirtualizedTurnTimelineItem";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

const command = (id: string) => ({
  aggregatedOutput: "done",
  command: "printf done",
  commandActions: [],
  cwd: "/workspace",
  durationMs: 10,
  exitCode: 0,
  id,
  processId: null,
  source: "agent",
  status: "completed",
  type: "commandExecution",
});

/** The Companion's activity totals of one turn with one command. */
const oneCommandMetrics = {
  codewide: {
    activityMetrics: {
      commands: {},
      ranges: [],
      total: {
        count: 1,
        kinds: ["commandExecution"],
        outputFootprint: {
          basis: "approxBytesPerToken",
          bytes: 4,
          estimatedInputCostUsd: null,
          estimatedTokens: 1,
          version: 1,
        },
      },
      version: 1,
    },
  },
};

const answer = (id: string, text: string) => ({
  delivery: null,
  id,
  memoryCitation: null,
  phase: "final_answer",
  questions: null,
  text,
  type: "agentMessage",
});

function completedTurn(
  id: string,
  items: readonly unknown[],
  extra: Record<string, unknown> = {},
): TurnItem {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: id === "head" ? 100 : 200,
      durationMs: id === "head" ? 60_000 : 30_000,
      error: null,
      id,
      items,
      itemsView: "full",
      startedAt: 1,
      status: "completed",
      ...extra,
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnItem;
}

const head = completedTurn(
  "head",
  [
    {
      clientId: null,
      content: [{ text: "Deploy it", text_elements: [], type: "text" }],
      id: "head-prompt",
      type: "userMessage",
    },
    command("head-command"),
    answer("head-answer", "Waiting for the build."),
  ],
  oneCommandMetrics,
);
const wake = completedTurn(
  "wake",
  [command("wake-command"), answer("wake-answer", "The build is out.")],
  // An older Companion counted this wake turn as pre-turn lifecycle: zero activity.
  {
    codewide: {
      activityMetrics: {
        ...oneCommandMetrics.codewide.activityMetrics,
        total: { ...oneCommandMetrics.codewide.activityMetrics.total, count: 0, kinds: [] },
      },
    },
  },
);

function timelineSurface(turns: readonly TurnItem[]) {
  const rows = projectTimelineRows(turns, {
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
            presentation={projectTurnPresentation(row.item, null, false, false)}
            requestPrompt={null}
            turn={row.item}
          />
        ),
      )}
    </View>
  );
}

/** Lays out the rows that size an anchored line or chip by their container. */
function layOut(view: RenderResult, testID: string, width: number) {
  for (const row of view.getAllByTestId(testID)) {
    fireEvent(row, "layout", { nativeEvent: { layout: { height: 40, width, x: 0, y: 0 } } });
  }
}

function slicesOf(turns: readonly TurnItem[], turn: TurnItem) {
  return projectTimelineRows(turns, {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).filter((row) => row.item === turn);
}

it("draws a wake turn as its own bubble and keeps the earlier answer visible", () => {
  const view = render(timelineSurface([head, wake]));

  // Each turn keeps its own answer outside the history: an earlier answer may
  // hold a question the person still has to see.
  // (The Markdown test double renders every response block as one placeholder text.)
  expect(view.getAllByText("Rendered Markdown block")).toHaveLength(2);
  // Each turn has its own history; the wake counts its own command even when an
  // older Companion reported no activity for it.
  expect(view.getAllByText("ran commands · 1")).toHaveLength(2);
  // Each turn has its own footer with its own duration.
  expect(view.getByText("1m")).toBeOnTheScreen();
  expect(view.getByText("30.0 s")).toBeOnTheScreen();
  expect(view.queryByText("1m 30s")).toBeNull();
});

it("draws no rows for a wake that produced nothing", () => {
  const emptyWake = completedTurn("empty-wake", []);

  expect(slicesOf([head, emptyWake], emptyWake)).toHaveLength(0);
  expect(slicesOf([head, emptyWake], head).length).toBeGreaterThan(0);
});

it("keeps a wake whose content is not loaded and has no Companion totals", () => {
  const unknownWake = completedTurn("unknown-wake", [], { itemsView: "summary" });

  expect(slicesOf([unknownWake], unknownWake).length).toBeGreaterThan(0);
});

it("keeps a wake that only worked, with its history and the fallback text", () => {
  const silentWake = completedTurn("silent-wake", [command("silent-command")], oneCommandMetrics);
  const view = render(timelineSurface([silentWake]));

  expect(view.getByText("ran commands · 1")).toBeOnTheScreen();
  expect(view.getByText("No response was generated")).toBeOnTheScreen();
});

it("draws no activity group and no zero count for a turn without activity", () => {
  const plain = completedTurn(
    "head",
    [
      {
        clientId: null,
        content: [{ text: "Hi", text_elements: [], type: "text" }],
        id: "plain-prompt",
        type: "userMessage",
      },
      answer("plain-answer", "Hello."),
    ],
    {
      codewide: {
        activityMetrics: {
          ...oneCommandMetrics.codewide.activityMetrics,
          total: { ...oneCommandMetrics.codewide.activityMetrics.total, count: 0, kinds: [] },
        },
      },
    },
  );
  const view = render(timelineSurface([plain]));

  expect(view.queryByText(/Activity/u)).toBeNull();
  expect(view.queryByText(/· 0/u)).toBeNull();
});

const taskReport = (id: string, delivery: "wake" | "midTurn", name: string) => ({
  agentThreadId: null,
  delivery,
  durationMs: 1_000,
  id,
  kind: "agent",
  name,
  result: null,
  status: "completed",
  taskId: `task-${id}`,
  toolUses: 3,
  type: "codewideTaskNotification",
});

it("draws the reports that woke a turn as one line before its bubble", () => {
  const woken = completedTurn("woken", [
    taskReport("a", "wake", "Map sources"),
    taskReport("b", "wake", "Review spec"),
    answer("woken-answer", "Both are back."),
  ]);
  const view = render(timelineSurface([woken]));
  layOut(view, "task-notification-line-row", 600);

  expect(view.getByTestId("task-notification-line")).toBeOnTheScreen();
  expect(view.getByText("2 agents")).toBeOnTheScreen();
  // The avatars' dots show the status; only assistive technology reads it.
  expect(view.queryByText("finished")).toBeNull();
  expect(view.getByLabelText("2 agents finished")).toBeOnTheScreen();
  expect(view.getAllByText("Rendered Markdown block")).toHaveLength(1);
});

it("draws a person's mid-turn report after the answer it arrived during", () => {
  const person = completedTurn("person", [
    {
      clientId: null,
      content: [{ text: "Deploy it", text_elements: [], type: "text" }],
      id: "person-prompt",
      type: "userMessage",
    },
    taskReport("c", "midTurn", "Build"),
    answer("person-answer", "Deployed."),
  ]);
  const view = render(timelineSurface([person]));
  layOut(view, "task-notification-line-row", 600);

  expect(view.getAllByTestId("task-notification-line")).toHaveLength(1);
  expect(view.getByText("Build")).toBeOnTheScreen();
});

it("draws a background task that is not an agent with a terminal icon, not an agent avatar", () => {
  const woken = completedTurn("monitor", [
    { ...taskReport("m", "wake", 'Monitor "Deploy log" stream ended'), kind: "other" },
    answer("monitor-answer", "The stream ended."),
  ]);
  const view = render(timelineSurface([woken]));
  layOut(view, "task-notification-line-row", 600);

  expect(view.getByText("terminal-outline")).toBeOnTheScreen();
});

it("draws an agent's report with its avatar, not a terminal icon", () => {
  const woken = completedTurn("agent", [
    taskReport("a", "wake", "Map sources"),
    answer("agent-answer", "Mapped."),
  ]);
  const view = render(timelineSurface([woken]));
  layOut(view, "task-notification-line-row", 600);

  expect(view.queryByText("terminal-outline")).toBeNull();
});

it("bounds a report pill to half its container, not the window, and reserves its height before", () => {
  const woken = completedTurn("narrow", [
    taskReport("long", "wake", "Reuse backend images, build the frontend and bring the stand up"),
    answer("narrow-answer", "Done."),
  ]);
  const view = render(timelineSurface([woken]));

  // A split layout gives the conversation part of the window: before layout
  // the row holds the line's height without a width-dependent pill.
  expect(view.queryByTestId("task-notification-line")).toBeNull();
  expect(view.getByTestId("task-notification-line-row")).toHaveStyle({ minHeight: 40 });

  layOut(view, "task-notification-line-row", 320);
  expect(view.getByTestId("task-notification-line")).toHaveStyle({ maxWidth: 160 });

  layOut(view, "task-notification-line-row", 280);
  expect(view.getByTestId("task-notification-line")).toHaveStyle({ maxWidth: 140 });
});

it("opens a plain list of reports with fixed rows and a declared height", () => {
  const woken = completedTurn("listed", [
    taskReport("a", "wake", "Map sources"),
    taskReport("b", "wake", "Review spec"),
    answer("listed-answer", "Both are back."),
  ]);
  const view = render(timelineSurface([woken]));
  layOut(view, "task-notification-line-row", 900);

  fireEvent.press(view.getByTestId("task-notification-line"));

  // No heading: the list is the menu. Each row keeps the height its two lines
  // need, and the list declares the sum instead of being measured.
  expect(view.queryByText(/background task|reports/iu)).toBeNull();
  const rows = view.getAllByTestId("task-notification-row");
  expect(rows).toHaveLength(2);
  const heights = rows.map((row) => StyleSheet.flatten(row.props.style).height);
  const [rowHeight] = heights;
  expect(typeof rowHeight).toBe("number");
  expect(rowHeight).toBeGreaterThanOrEqual(48);
  expect(heights.every((height) => height === rowHeight)).toBe(true);
  expect(view.getByTestId("task-notification-list")).toHaveStyle({
    height: Number(rowHeight) * 2 + 4 + 8 * 2,
  });
  expect(view.queryByText(/finished/u)).toBeNull();
});

const launch = (id: string, receiver: string, description: string) => ({
  agentsStates: { [receiver]: { message: null, status: "running" } },
  codewideDescription: description,
  id,
  prompt: "Long prompt",
  receiverThreadIds: [receiver],
  status: "inProgress",
  tool: "spawnAgent",
  type: "collabAgentToolCall",
});

it("draws no launch chip in a bubble, since a launch is not a result", () => {
  const launcher = completedTurn(
    "launcher",
    [
      {
        clientId: null,
        content: [{ text: "Research it", text_elements: [], type: "text" }],
        id: "launcher-prompt",
        type: "userMessage",
      },
      launch("l1", "t1", "Map sources"),
      launch("l2", "t2", "Review spec"),
      answer("launcher-answer", "Both started."),
    ],
    oneCommandMetrics,
  );
  const view = render(timelineSurface([launcher]));

  expect(view.getByTestId("codex-bubble")).toBeOnTheScreen();
  expect(view.queryByText(/agents? started/u)).toBeNull();
});

it("folds a running turn's current tool calls into one row showing only the running one", () => {
  const running = completedTurn(
    "busy",
    [
      {
        clientId: null,
        content: [{ text: "Build it", text_elements: [], type: "text" }],
        id: "busy-prompt",
        type: "userMessage",
      },
      answer("busy-progress", "Starting the build."),
      command("done-1"),
      command("done-2"),
      { ...command("running"), command: "pnpm build", status: "inProgress" },
    ],
    { completedAt: null, status: "inProgress" },
  );
  const view = render(timelineSurface([running]));

  expect(view.getByTestId("active-turn-activity")).toBeOnTheScreen();
  expect(view.getByText(/· 3/u)).toBeOnTheScreen();
  const current = within(view.getByTestId("active-turn-current-actions"));
  expect(current.getAllByText(/pnpm build/u).length).toBeGreaterThan(0);
  expect(current.queryAllByText(/printf done/u)).toHaveLength(0);
  // The progress text before the tool calls stays visible.
  expect(view.getAllByText("Rendered Markdown block").length).toBeGreaterThan(0);
});
