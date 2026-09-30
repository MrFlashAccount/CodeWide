import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ActivityMetrics, ProjectedTurnMetadata } from "@codewide/sync-client";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { CompletedTurnHistory } from "../src/features/conversation/turns/CompletedTurnHistory";
import { persistentExpansionStates } from "../src/features/conversation/turns/disclosureState";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

const reasoning: Turn["items"][number] = {
  content: [],
  id: "reasoning",
  summary: ["Checking the answer"],
  type: "reasoning",
};
const command: Turn["items"][number] = {
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

function agentMessage(id: string, text: string): Turn["items"][number] {
  return {
    delivery: null,
    id,
    memoryCitation: null,
    phase: "commentary",
    questions: null,
    text,
    type: "agentMessage",
  };
}

function metrics(kinds: string[], count: number): ActivityMetrics {
  return {
    version: 1,
    total: {
      count,
      kinds,
      outputFootprint: {
        version: 1,
        basis: "approxBytesPerToken",
        bytes: 0,
        estimatedTokens: 0,
        estimatedInputCostUsd: null,
      },
    },
    ranges: [],
    commands: {},
  };
}

function completedTurn(
  activity: Turn["items"],
  itemsView: Turn["itemsView"] = "full",
  codewide: ProjectedTurnMetadata = {},
): TurnItem {
  const turn: Turn & { codewide: ProjectedTurnMetadata } = {
    codewide,
    completedAt: 2,
    durationMs: 1000,
    error: null,
    id: "turn",
    itemsView,
    items: [
      {
        clientId: null,
        content: [{ text: "Prompt", text_elements: [], type: "text" }],
        id: "prompt",
        type: "userMessage",
      },
      ...activity,
      agentMessage("answer", "Final answer"),
    ],
    startedAt: 1,
    status: "completed",
  };
  return {
    connectionId: "server",
    id: turn.id,
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn,
  };
}

function history(
  item: TurnItem,
  forceExpanded = false,
  onLoadItems?: (id: string) => Promise<void>,
) {
  return (
    <CompletedTurnHistory
      compact
      forceExpanded={forceExpanded}
      item={item}
      {...(onLoadItems === undefined ? {} : { onLoadItems })}
    />
  );
}

beforeEach(() => persistentExpansionStates.clear());

it.each([false, true])(
  "hides a fully loaded thinking-only accordion (forced open: %s)",
  (forceExpanded) => {
    const cases: ProjectedTurnMetadata[] = [
      {},
      { activity: { count: 1, kinds: ["reasoning"] } },
      { activityMetrics: metrics(["reasoning"], 1) },
      { activityMetrics: metrics([], 0) },
    ];
    const view = render(history(completedTurn([reasoning]), forceExpanded));
    for (const metadata of cases) {
      const item = completedTurn([reasoning], "full", metadata);
      view.rerender(history(item, forceExpanded));
      expect(view.queryByTestId("turn-activity")).toBeNull();
      expect(projectTurnPresentation(item, null, false, false).agentBubbleFill).toBe(false);
    }
  },
);

it.each([{ activity: [] }, { activity: [agentMessage("empty", "   ")] }])(
  "hides history containing no visible activity: %j",
  ({ activity }) => {
    const view = render(history(completedTurn(activity), true));
    expect(view.queryByTestId("turn-activity")).toBeNull();
  },
);

it.each(["summary", "notLoaded"] as const)(
  "does not offer an empty accordion when %s metadata declares only reasoning",
  (itemsView) => {
    const load = jest.fn(async () => undefined);
    const item = completedTurn([], itemsView, { activity: { count: 2, kinds: ["reasoning"] } });
    const view = render(history(item, false, load));
    expect(view.queryByTestId("turn-activity")).toBeNull();
    expect(projectTurnPresentation(item, null, false, false).agentBubbleFill).toBe(false);
    view.rerender(
      history(
        completedTurn([], itemsView, { activityMetrics: metrics(["reasoning"], 2) }),
        false,
        load,
      ),
    );
    expect(view.queryByTestId("turn-activity")).toBeNull();
    expect(load).not.toHaveBeenCalled();
  },
);

it("keeps real tool activity and its server-provided figures alongside hidden reasoning", () => {
  const item = completedTurn([reasoning, command], "full", {
    activityMetrics: metrics(["commandExecution"], 58),
  });
  const view = render(history(item, true));
  expect(view.getByRole("button", { name: "Collapse activity ran commands · 58" })).toBeVisible();
  expect(view.getByRole("button", { name: "Collapse printf done" })).toBeVisible();
  expect(view.queryByTestId("thinking-status")).toBeNull();
  expect(projectTurnPresentation(item, null, false, false).agentBubbleFill).toBe(true);
});

it("preserves earlier agent messages in completed history", () => {
  const view = render(
    history(completedTurn([reasoning, agentMessage("progress", "Intermediate update")]), true),
  );
  expect(
    within(view.getByTestId("turn-activity-list")).getByText("Intermediate update"),
  ).toBeVisible();
  expect(view.queryByTestId("thinking-status")).toBeNull();
});

it.each([
  {
    plan: {
      explanation: "Recorded plan",
      steps: [{ step: "Check output", status: "completed" as const }],
    },
  },
  {
    diff: "diff --git a/example.txt b/example.txt\n--- a/example.txt\n+++ b/example.txt\n@@ -1 +1 @@\n-before\n+after",
  },
])("keeps metadata-only history even when item counts are zero: %j", (metadata) => {
  const item = completedTurn([reasoning], "full", { ...metadata, activityMetrics: metrics([], 0) });
  const view = render(history(item, true));
  expect(view.getAllByTestId("turn-activity-list").length).toBeGreaterThan(0);
  expect(view.getByText("plan" in metadata ? "Plan" : "Turn diff")).toBeVisible();
  expect(projectTurnPresentation(item, null, false, false).agentBubbleFill).toBe(true);
});

it("hides a sparse summary without Companion's positive activity signal", () => {
  const load = jest.fn(async () => undefined);
  const item = completedTurn([], "summary");
  const view = render(history(item, false, load));
  expect(view.queryByTestId("turn-activity")).toBeNull();
  expect(projectTurnPresentation(item, null, false, false).agentBubbleFill).toBe(false);
  expect(load).not.toHaveBeenCalled();
});

it.each(["summary", "notLoaded"] as const)(
  "preserves explicit lazy loading for a %s turn when Companion declares visible activity",
  async (itemsView) => {
    const metadata: ProjectedTurnMetadata =
      itemsView === "notLoaded"
        ? { activity: { count: 2, kinds: ["reasoning", "commandExecution"] } }
        : { activityMetrics: metrics(["reasoning", "commandExecution"], 2) };
    const load = jest.fn(async () => undefined);
    const view = render(history(completedTurn([], itemsView, metadata), false, load));
    expect(load).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(view.getByRole("button", { name: /^Expand activity/ }));
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("turn");
    view.rerender(history(completedTurn([reasoning], "full", metadata), false, load));
    expect(view.queryByTestId("turn-activity")).toBeNull();
  },
);

it("reveals lazily loaded nonempty history after expansion", async () => {
  const load = jest.fn(async () => undefined);
  const metadata = { activityMetrics: metrics(["agentMessage"], 1) };
  const view = render(history(completedTurn([], "summary", metadata), false, load));
  await act(async () => {
    fireEvent.press(view.getByRole("button", { name: /^Expand activity/ }));
  });
  view.rerender(
    history(
      completedTurn([reasoning, agentMessage("progress", "Loaded update")], "full", metadata),
      false,
      load,
    ),
  );
  expect(within(view.getByTestId("turn-activity-list")).getByText("Loaded update")).toBeVisible();
});
