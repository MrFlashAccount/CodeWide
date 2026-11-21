import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { describe, expect, it } from "vitest";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { reportLineSummary } from "../src/features/conversation/turns/taskNotificationPresentation";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { compactCompletedTurnForStorage } from "../src/data/thread-detail-projection";
import { turnTaskNotifications } from "../src/rendering/taskNotifications";
import { selectTurnRenderWindow } from "../src/rendering/thread-render-window";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;
type Turn = Thread["turns"][number];

const options = { enabled: true, searchMessageItemId: null, threadSearchActive: false };

function report(
  id: string,
  fields: Partial<Record<"agentThreadId" | "delivery" | "kind" | "name" | "status", string>> = {},
) {
  return {
    agentThreadId: null,
    delivery: "wake",
    durationMs: 480_000,
    id,
    kind: "agent",
    name: `Agent ${id}`,
    result: "Done.",
    status: "completed",
    taskId: `task-${id}`,
    toolUses: 71,
    type: "codewideTaskNotification",
    ...fields,
  };
}

const prompt = (id: string) => ({
  clientId: null,
  content: [{ text: "Do it", text_elements: [], type: "text" }],
  id: `${id}-prompt`,
  type: "userMessage",
});

const answer = (id: string) => ({
  id: `${id}-answer`,
  phase: "final_answer",
  text: `Answer ${id}`,
  type: "agentMessage",
});

function turn(id: string, items: readonly unknown[]): TurnItem {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: 2,
      durationMs: 1,
      error: null,
      id,
      items,
      itemsView: "full",
      startedAt: 1,
      status: "completed",
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnItem;
}

describe("task notification reports", () => {
  it("splits a turn's valid reports by delivery and keeps them out of turn activity", () => {
    const wake = turn("wake", [
      report("a"),
      { ...report("broken"), taskId: "" },
      answer("wake"),
      report("b", { delivery: "midTurn", status: "interim" }),
    ]);

    const reports = turnTaskNotifications(wake.turn);
    expect(reports.wake.map((entry) => entry.id)).toEqual(["a"]);
    expect(reports.midTurn).toMatchObject([{ id: "b", status: "interim" }]);
    const window = selectTurnRenderWindow(wake.turn);
    expect(window.collapsedActivityIndexes).toEqual([]);
    expect(window.latestAgentIndex).toBe(2);
  });

  it("draws a wake's reports as a line before its bubble", () => {
    const wake = turn("wake", [report("a"), answer("wake"), report("b", { delivery: "midTurn" })]);

    const rows = projectTimelineRows([wake], options);
    expect(rows.map((row) => row.kind)).toEqual(["turnLead", "turnSlice"]);
    expect(rows[0]).toMatchObject({ notifications: [{ id: "a" }, { id: "b" }] });
  });

  it("keeps a person's mid-turn reports with its answer, not on its lead", () => {
    const person = turn("person", [
      prompt("person"),
      report("a", { delivery: "midTurn" }),
      answer("person"),
    ]);

    const rows = projectTimelineRows([person], options);
    expect(rows[0]).toMatchObject({ kind: "turnLead", notifications: [] });
    expect(
      projectTurnPresentation(person, null, false, false).taskNotifications.midTurn,
    ).toHaveLength(1);
  });

  it("joins consecutive wakes that produced nothing into the next wake's line", () => {
    const first = turn("first", [report("a")]);
    const second = turn("second", [report("b")]);
    const answering = turn("answering", [report("c"), answer("answering")]);

    const rows = projectTimelineRows(
      [turn("head", [prompt("head"), answer("head")]), first, second, answering],
      options,
    );
    const leads = rows.filter((row) => row.kind === "turnLead");
    expect(leads.map((row) => row.notifications.map((entry) => entry.id))).toEqual([
      [],
      ["a", "b", "c"],
    ]);
    // No turn content moves: the answering wake still owns its bubble.
    expect(rows.filter((row) => row.kind === "turnSlice").map((row) => row.item.id)).toEqual([
      "head",
      "answering",
    ]);
  });

  it("keeps a trailing run of silent wakes as one line", () => {
    const rows = projectTimelineRows(
      [turn("first", [report("a")]), turn("second", [report("b")])],
      options,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "turnLead", notifications: [{ id: "a" }, { id: "b" }] });
  });

  it("summarises several reports with failures first", () => {
    const parsed = turnTaskNotifications(
      turn("wake", [
        report("a"),
        report("b", { status: "failed" }),
        report("c", { status: "interim" }),
      ]).turn,
    ).wake;

    expect(reportLineSummary(parsed)).toEqual({
      label: "3 agents",
      phrase: "some failed",
    });
    expect(reportLineSummary(parsed.slice(0, 1))).toEqual({
      label: "Agent a",
      phrase: "finished",
    });
  });
});

describe("child agent result notices", () => {
  const single = {
    agentThreadId: "child-1",
    delivery: "wake",
    durationMs: null,
    id: "m1",
    kind: "agent",
    name: "Review",
    requestId: "r1",
    result: null,
    status: "interrupted",
    taskId: "t1",
    toolUses: null,
    turnId: "turn-1",
    type: "codewideTaskNotification",
  };
  const batched = {
    agentThreadId: null,
    delivery: "wake",
    durationMs: null,
    id: "m2",
    kind: "agent",
    name: "2 agent results",
    reports: [
      {
        agentThreadId: "child-1",
        id: "m2:0",
        name: "Review",
        requestId: "r1",
        status: "completed",
        taskId: "t1",
        turnId: "turn-1",
      },
      {
        agentThreadId: "child-2",
        id: "m2:1",
        name: "Tests",
        requestId: "r2",
        status: "failed",
        taskId: "r2",
        turnId: "turn-9",
      },
    ],
    requestId: null,
    result: null,
    status: "failed",
    taskId: "t1",
    toolUses: null,
    turnId: null,
    type: "codewideTaskNotification",
  };

  it("reads an interrupted child agent as interrupted, not unknown", () => {
    const [parsed] = turnTaskNotifications(turn("wake", [single]).turn).wake;

    expect(parsed).toEqual({
      agentThreadId: "child-1",
      delivery: "wake",
      durationMs: null,
      id: "m1",
      kind: "agent",
      name: "Review",
      result: null,
      status: "interrupted",
      taskId: "t1",
      toolUses: null,
    });
    expect(reportLineSummary([parsed!])).toEqual({ label: "Review", phrase: "was interrupted" });
  });

  it("expands a batched notice into one report per child agent", () => {
    const reports = turnTaskNotifications(turn("wake", [batched]).turn);

    expect(reports.midTurn).toEqual([]);
    expect(reports.wake).toEqual([
      {
        agentThreadId: "child-1",
        delivery: "wake",
        durationMs: null,
        id: "m2:0",
        kind: "agent",
        name: "Review",
        result: null,
        status: "completed",
        taskId: "t1",
        toolUses: null,
      },
      {
        agentThreadId: "child-2",
        delivery: "wake",
        durationMs: null,
        id: "m2:1",
        kind: "agent",
        name: "Tests",
        result: null,
        status: "failed",
        taskId: "r2",
        toolUses: null,
      },
    ]);
    expect(reportLineSummary(reports.wake)).toEqual({ label: "2 agents", phrase: "some failed" });
  });

  it("skips invalid batch entries and inherits the notice's delivery", () => {
    const notice = {
      ...batched,
      delivery: "midTurn",
      reports: [
        { ...batched.reports[0], id: " " },
        { ...batched.reports[1], taskId: "" },
        "garbage",
        { ...batched.reports[1], status: "exploded" },
        { ...batched.reports[1], name: "Duplicate" },
      ],
    };

    const reports = turnTaskNotifications(turn("wake", [notice]).turn);

    expect(reports.wake).toEqual([]);
    expect(reports.midTurn).toMatchObject([
      { delivery: "midTurn", id: "m2:1", kind: "agent", name: "Tests", status: "unknown" },
    ]);
  });

  it("falls back to the summary when no batch entry is valid", () => {
    const notice = { ...batched, reports: [{ id: "", taskId: "t1" }] };

    expect(turnTaskNotifications(turn("wake", [notice]).turn).wake).toMatchObject([
      { agentThreadId: null, id: "m2", name: "2 agent results", status: "failed", taskId: "t1" },
    ]);
  });
});

describe("wake lines and stored turns", () => {
  it("keeps the first wake's row when later wakes join its line", () => {
    const first = turn("first", [report("a")]);
    const alone = projectTimelineRows([first], options);
    const joined = projectTimelineRows([first, turn("second", [report("b")])], options);

    expect(joined).toHaveLength(1);
    expect(joined[0]?.key).toBe(alone[0]?.key);
    expect(joined[0]?.item).toBe(first);
  });

  it("keeps a wake line apart from the person's turn that follows it", () => {
    const rows = projectTimelineRows(
      [turn("wake", [report("a")]), turn("person", [prompt("person"), answer("person")])],
      options,
    );

    expect(rows.map((row) => [row.kind, row.item.id])).toEqual([
      ["turnLead", "wake"],
      ["turnLead", "person"],
      ["turnSlice", "person"],
    ]);
  });

  it("does not hide a summarised wake from a Companion that sent no reports", () => {
    const unknown: TurnItem = {
      ...turn("old", []),
      turn: { ...turn("old", []).turn, itemsView: "summary" },
    };

    expect(projectTimelineRows([unknown], options).length).toBeGreaterThan(0);
  });

  it("keeps reports when a finished turn is stored compactly", () => {
    const command = { command: "ls", id: "command", status: "completed", type: "commandExecution" };
    const stored = compactCompletedTurnForStorage(
      turn("wake", [report("a"), command, answer("wake")]).turn,
    );

    expect(stored.itemsView).toBe("summary");
    expect(turnTaskNotifications(stored).wake.map((entry) => entry.id)).toEqual(["a"]);
    expect(stored.items.some((item) => item.id === "command")).toBe(false);
  });
});
