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

function completedTurn(id: string, items: readonly unknown[], extra: Record<string, unknown> = {}): TurnItem {
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

const head = completedTurn("head", [
  {
    clientId: null,
    content: [{ text: "Deploy it", text_elements: [], type: "text" }],
    id: "head-prompt",
    type: "userMessage",
  },
  command("head-command"),
  answer("head-answer", "Waiting for the build."),
], oneCommandMetrics);
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

function bubbleSurface() {
  const rows = projectTimelineRows([head, wake], {
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

it("draws no activity group and no zero count for a turn without activity", () => {
  const plain = completedTurn("head", [
    {
      clientId: null,
      content: [{ text: "Hi", text_elements: [], type: "text" }],
      id: "plain-prompt",
      type: "userMessage",
    },
    answer("plain-answer", "Hello."),
  ], {
    codewide: {
      activityMetrics: {
        ...oneCommandMetrics.codewide.activityMetrics,
        total: { ...oneCommandMetrics.codewide.activityMetrics.total, count: 0, kinds: [] },
      },
    },
  });
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
