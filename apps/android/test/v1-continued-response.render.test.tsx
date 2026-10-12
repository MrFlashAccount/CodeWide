import { fireEvent, render } from "@testing-library/react-native";
import { View } from "react-native";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { VirtualizedTurnTimelineItem } from "../src/features/conversation/turns/VirtualizedTurnTimelineItem";

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

function bubbleSurface(turns: readonly TurnItem[] = [head, wake]) {
  const rows = projectTimelineRows(turns, {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).filter((row) => row.kind === "turnSlice");
  return (
    <View>
      {rows.map((row) => (
        <VirtualizedTurnTimelineItem
          animateLiveUpdates={false}
          bubble={row.bubble}
          compact={false}
          followsLead={row.followsLead}
          forceExpanded={false}
          group={row.group}
          key={row.key}
          parts={row.parts}
          placement={row.placement}
          presentation={projectTurnPresentation(row.item, null, false, false)}
          requestPrompt={null}
          turn={row.item}
        />
      ))}
    </View>
  );
}

it("draws a continued response as one activity group and the latest answer", () => {
  const view = render(bubbleSurface());

  // Both turns' commands share one collapsed history at the top of the bubble.
  expect(view.getAllByText("ran commands · 2")).toHaveLength(1);
  // Only the latest answer stays outside; the earlier one is an update inside the history.
  // (The Markdown test double renders every response block as one placeholder text.)
  expect(view.getAllByText("Rendered Markdown block")).toHaveLength(1);
  expect(view.queryByText("Waiting for the build.")).toBeNull();
  fireEvent.press(view.getByText("ran commands · 2"));
  expect(view.getByText("Waiting for the build.")).toBeOnTheScreen();
  // The footer appears once, with the duration of both turns.
  expect(view.queryAllByText("1m 30s")).toHaveLength(1);
  expect(view.queryByText("1m 0s")).toBeNull();
});

it("does not render an empty head turn as a response before the continuation answer", () => {
  const emptyHead = completedTurn("head", [
    {
      clientId: null,
      content: [{ text: "Deploy it", text_elements: [], type: "text" }],
      id: "head-prompt",
      type: "userMessage",
    },
  ]);
  const view = render(bubbleSurface([emptyHead, wake]));

  expect(view.queryByText("No response was generated")).toBeNull();
  expect(view.queryByText("Stopped before response was generated")).toBeNull();
  expect(view.getAllByText("Rendered Markdown block")).toHaveLength(1);
});

it("renders one presentation fallback when the combined bubble is empty", () => {
  const emptyHead = completedTurn("empty-head", [
    {
      clientId: null,
      content: [{ text: "Deploy it", text_elements: [], type: "text" }],
      id: "empty-head-prompt",
      type: "userMessage",
    },
  ]);
  const emptyWake = completedTurn("empty-wake", []);
  const view = render(bubbleSurface([emptyHead, emptyWake]));

  expect(view.getAllByText("No response was generated")).toHaveLength(1);
});

it("keeps an earlier answer folded while its continuation is running", () => {
  const liveHead = completedTurn("live-head", head.turn.items, oneCommandMetrics);
  const liveWake = completedTurn(
    "live-wake",
    [command("wake-command"), answer("wake-answer", "Still working.")],
    { completedAt: null, status: "inProgress" },
  );
  const view = render(bubbleSurface([liveHead, liveWake]));

  expect(view.getAllByText("Rendered Markdown block")).toHaveLength(1);
  expect(view.queryByText("Waiting for the build.")).toBeNull();
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
  const rows = projectTimelineRows([plain], {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).filter((row) => row.kind === "turnSlice");
  const view = render(
    <View>
      {rows.map((row) => (
        <VirtualizedTurnTimelineItem
          animateLiveUpdates={false}
          bubble={row.bubble}
          compact={false}
          followsLead={row.followsLead}
          forceExpanded={false}
          group={row.group}
          key={row.key}
          parts={row.parts}
          placement={row.placement}
          presentation={projectTurnPresentation(row.item, null, false, false)}
          requestPrompt={null}
          turn={row.item}
        />
      ))}
    </View>,
  );
  expect(view.queryByText(/Activity/u)).toBeNull();
  expect(view.queryByText(/· 0/u)).toBeNull();
});

it("keeps a running head's own rows when its continuation already finished", () => {
  // Claude answered a wake while the head still waited for an approval.
  const running = completedTurn("head", head.turn.items, {
    ...oneCommandMetrics,
    completedAt: null,
    status: "inProgress",
  });
  const rows = projectTimelineRows([running, wake], {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).filter((row) => row.kind === "turnSlice");
  const headRows = rows.filter((row) => row.item === running);
  // Not folded into an empty history slice: a running turn has none to show.
  expect(headRows.length).toBeGreaterThan(0);
  expect(headRows.every((row) => row.parts.every((part) => part.kind !== "empty"))).toBe(true);
  // Both turns still share one bubble.
  expect(rows.every((row) => row.group?.members.length === 2)).toBe(true);
});
