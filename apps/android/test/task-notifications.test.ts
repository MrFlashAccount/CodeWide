import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { describe, expect, it } from "vitest";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { reportLineSummary } from "../src/features/conversation/turns/taskNotificationPresentation";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { turnLaunchedAgents } from "../src/rendering/launchedAgents";
import { selectRunningAgents } from "../src/rendering/runningAgents";
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
      badge: "failed",
      label: "3 agents",
      phrase: "some failed",
    });
    expect(reportLineSummary(parsed.slice(0, 1))).toEqual({
      badge: "done",
      label: "Agent a",
      phrase: "finished",
    });
  });
});

describe("running agents", () => {
  const launch = (id: string, receiver: string, status: string) => ({
    agentsStates: { [receiver]: { message: null, status } },
    codewideDescription: `Agent ${id}`,
    id,
    prompt: "Long prompt",
    receiverThreadIds: [receiver],
    status: "inProgress",
    tool: "spawnAgent",
    type: "collabAgentToolCall",
  });

  function thread(turns: readonly TurnItem[], primary: boolean): Thread {
    const value: unknown = {
      codewideAgent: { capabilities: [], primary, provider: "claude", providerName: "Claude" },
      id: "thread",
      turns: turns.map((entry): Turn => entry.turn),
    };
    // WHY: The generated Thread type has many fields the selector never reads; the fixture
    // supplies only the turns and the provider descriptor it consumes.
    return value as Thread;
  }

  it("lists launched agents until a final report arrives", () => {
    const turns = [
      turn("launch", [
        prompt("launch"),
        launch("l1", "t1", "running"),
        launch("l2", "t2", "running"),
      ]),
      turn("wake", [
        report("a", { agentThreadId: "t1" }),
        report("b", { agentThreadId: "t2", status: "interim" }),
      ]),
    ];

    expect(selectRunningAgents(thread(turns, false))).toEqual([
      { agentThreadId: "t2", kind: "agent", name: "Agent l2" },
    ]);
  });

  it("does not trust launch state from a primary provider", () => {
    const turns = [turn("launch", [prompt("launch"), launch("l1", "t1", "running")])];

    expect(selectRunningAgents(thread(turns, true))).toEqual([]);
  });
});

describe("launched agents", () => {
  it("names a launch by its description, else its path, else its prompt", () => {
    const launches = turnLaunchedAgents(
      turn("launcher", [
        {
          codewideDescription: "Map sources",
          id: "a",
          receiverThreadIds: ["t1"],
          tool: "spawnAgent",
          type: "collabAgentToolCall",
        },
        {
          agentPath: "/root/code_reviewer",
          id: "b",
          receiverThreadIds: ["t2"],
          tool: "spawnAgent",
          type: "collabAgentToolCall",
        },
        {
          id: "c",
          prompt: "Check the build\nthen report",
          receiverThreadIds: [],
          tool: "spawnAgent",
          type: "collabAgentToolCall",
        },
        { id: "d", receiverThreadIds: ["t3"], tool: "wait", type: "collabAgentToolCall" },
      ]).turn,
    );

    expect(launches.map((agent) => [agent.name, agent.agentThreadId])).toEqual([
      ["Map sources", "t1"],
      ["code reviewer", "t2"],
      ["Check the build", null],
    ]);
  });
});
