import { render } from "@testing-library/react-native";
import { View } from "react-native";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import {
  VirtualizedTurnLeadItem,
  VirtualizedTurnTimelineItem,
} from "../src/features/conversation/turns/VirtualizedTurnTimelineItem";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

const prompt = {
  clientId: null,
  content: [{ text: "Continue", text_elements: [], type: "text" }],
  id: "prompt",
  type: "userMessage",
};

const command = {
  aggregatedOutput: "done",
  command: "printf done",
  commandActions: [],
  cwd: "/workspace",
  durationMs: 10,
  exitCode: 0,
  id: "command",
  processId: null,
  source: "agent",
  status: "completed",
  type: "commandExecution",
};

const answer = {
  delivery: null,
  id: "answer",
  memoryCitation: null,
  phase: "final_answer",
  questions: null,
  text: "Done.",
  type: "agentMessage",
};

function compaction(phase?: "started") {
  return {
    id: "compaction",
    type: "contextCompaction",
    ...(phase === undefined ? {} : { codewideLifecyclePhase: phase }),
  };
}

function turnItem(
  status: "completed" | "inProgress",
  items: readonly unknown[],
  extra: Record<string, unknown> = {},
): TurnItem {
  const value: unknown = {
    connectionId: "server",
    id: "turn",
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: status === "completed" ? 25 : null,
      durationMs: status === "completed" ? 24_000 : null,
      error: null,
      id: "turn",
      items,
      itemsView: "full",
      startedAt: 1,
      status,
      ...extra,
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnItem;
}

function timelineSurface(turn: TurnItem) {
  const rows = projectTimelineRows([turn], {
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

it("draws a running compaction-only turn as one system line without a bubble", () => {
  const view = render(timelineSurface(turnItem("inProgress", [compaction("started")])));

  expect(view.getByLabelText("Compacting context, running")).toBeOnTheScreen();
  expect(view.queryByTestId("codex-bubble")).toBeNull();
  expect(view.queryByTestId("turn-thinking-placeholder")).toBeNull();
});

it.each([
  { items: [compaction()], name: "a full turn" },
  { items: [prompt, compaction()], name: "a turn started by a person" },
])("draws a finished compaction of $name as one system line", ({ items }) => {
  const view = render(timelineSurface(turnItem("completed", items)));

  expect(view.getByLabelText("Context compacted, completed")).toBeOnTheScreen();
  expect(view.queryByTestId("codex-bubble")).toBeNull();
  expect(view.queryByText("No response was generated")).toBeNull();
  expect(view.queryByText(/activit/)).toBeNull();
  // The duration and usage footer belongs to a response, which this turn has not.
  expect(view.queryByText("24.0 s")).toBeNull();
});

it("draws a summarised compaction-only turn from Companion totals without a bubble", () => {
  const summary = turnItem("completed", [compaction()], {
    codewide: {
      activityMetrics: {
        commands: {},
        ranges: [],
        total: { count: 0, kinds: [] },
        version: 1,
      },
    },
    itemsView: "summary",
  });
  const view = render(timelineSurface(summary));

  expect(view.getByLabelText("Context compacted, completed")).toBeOnTheScreen();
  expect(view.queryByTestId("codex-bubble")).toBeNull();
});

it("keeps a compaction during a running response inside its bubble, as its work", () => {
  const running = turnItem("inProgress", [prompt, command, compaction("started")]);
  const view = render(timelineSurface(running));

  const bubble = view.getByTestId("codex-bubble");
  // No lifecycle line outside: the compaction is the current action of the group.
  expect(view.queryByTestId("pre-turn-lifecycle")).toBeNull();
  expect(bubble).toContainElement(view.getByText("Compacting context"));
  expect(bubble).toContainElement(view.getByText(/· 2$/u));
});

it("draws a finished turn's compaction above its bubble and outside its history", () => {
  const view = render(timelineSurface(turnItem("completed", [prompt, compaction(), answer])));

  const bubble = view.getByTestId("codex-bubble");
  const line = view.getByLabelText("Context compacted, completed");
  expect(bubble).not.toContainElement(line);
  const order = JSON.stringify(view.toJSON());
  expect(order.indexOf("Context compacted")).toBeLessThan(order.indexOf('"codex-bubble"'));
  expect(view.queryByText(/activit/)).toBeNull();
});
