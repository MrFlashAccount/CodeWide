import { describe, expect, it, vi } from "vitest";

import { LIVE_ACTIVITY_WINDOW, selectTurnRenderWindow } from "../src/rendering/thread-render-window";

type FakeItem = {
  type: "userMessage" | "agentMessage" | "commandExecution" | "reasoning";
  id: string;
  text?: string;
  phase?: "commentary" | "final_answer" | null;
};

function turn(items: FakeItem[], status: "inProgress" | "completed" = "inProgress") {
  return {
    items: items.map((item) => item.type === "agentMessage"
      ? { ...item, text: item.text ?? item.id, phase: item.phase ?? null }
      : item),
    status,
  } as Parameters<typeof selectTurnRenderWindow>[0];
}

describe("thread render window", () => {
  it("keeps every active progress message visible while bounding activity cards", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      ...Array.from({ length: 20 }, (_, index) => ({ type: "commandExecution" as const, id: `before-${index}` })),
      { type: "agentMessage", id: "progress" },
      ...Array.from({ length: 30 }, (_, index) => ({ type: "commandExecution" as const, id: `after-${index}` })),
    ];

    const window = selectTurnRenderWindow(turn(items));

    expect(window.userItemIndexes).toEqual([0]);
    expect(window.latestAgentIndex).toBe(21);
    expect(window.liveActivityIndexes).toHaveLength(LIVE_ACTIVITY_WINDOW + 1);
    expect(window.liveActivityIndexes).toContain(21);
    expect(window.liveActivityIndexes.at(-1)).toBe(items.length - 1);
    expect(window.collapsedActivityIndexes).toHaveLength(34);
  });

  it("keeps progress messages between the actions they describe", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      { type: "commandExecution", id: "tool-1" },
      { type: "agentMessage", id: "progress-1" },
      { type: "commandExecution", id: "tool-2" },
      { type: "agentMessage", id: "progress-2" },
      { type: "commandExecution", id: "tool-3" },
    ];

    const window = selectTurnRenderWindow(turn(items));

    expect(window.latestAgentIndex).toBe(4);
    expect(window.collapsedActivityIndexes).toEqual([]);
    expect(window.liveActivityIndexes).toEqual([1, 2, 3, 4, 5]);
  });

  it("streams a phased final answer before the turn completes", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      { type: "commandExecution", id: "tool" },
      { type: "agentMessage", id: "progress", phase: "commentary" },
      { type: "agentMessage", id: "final", phase: "final_answer" },
    ];

    const window = selectTurnRenderWindow(turn(items));

    expect(window.latestAgentIndex).toBe(3);
    expect(window.liveActivityIndexes).toEqual([1, 2, 3]);
  });

  it("keeps intermediate agent messages inside completed Activity", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      { type: "commandExecution", id: "tool" },
      { type: "agentMessage", id: "draft" },
      { type: "commandExecution", id: "tool-2" },
      { type: "agentMessage", id: "final" },
    ];

    const window = selectTurnRenderWindow(turn(items, "completed"));

    expect(window.latestAgentIndex).toBe(4);
    expect(window.liveActivityIndexes).toEqual([]);
    expect(window.collapsedActivityIndexes).toEqual([1, 2, 3]);
  });

  it("keeps text-only intermediate commentary recoverable in Activity", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      { type: "agentMessage", id: "commentary" },
      { type: "agentMessage", id: "final" },
    ];

    const window = selectTurnRenderWindow(turn(items, "completed"));

    expect(window.latestAgentIndex).toBe(2);
    expect(window.collapsedActivityIndexes).toEqual([1]);
  });

  it("uses the explicit final answer after completion even if commentary follows it", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      { type: "agentMessage", id: "final", phase: "final_answer" },
      { type: "agentMessage", id: "late-progress", phase: "commentary" },
    ];

    const window = selectTurnRenderWindow(turn(items, "completed"));

    expect(window.latestAgentIndex).toBe(1);
    expect(window.collapsedActivityIndexes).toEqual([2]);
  });

  it("bounds rich projection work for a very long streaming turn", () => {
    const items: FakeItem[] = [
      { type: "userMessage", id: "user" },
      ...Array.from({ length: 20_000 }, (_, index) => ({ type: "commandExecution" as const, id: `tool-${index}` })),
    ];
    const project = vi.fn((index: number) => items[index]);
    const window = selectTurnRenderWindow(turn(items));

    window.liveActivityIndexes.map(project);

    expect(project).toHaveBeenCalledTimes(LIVE_ACTIVITY_WINDOW);
    expect(window.collapsedActivityIndexes).toHaveLength(20_000 - LIVE_ACTIVITY_WINDOW);
  });

  it("shows Thinking only while it is the latest item in an active turn", () => {
    const thinkingLast: FakeItem[] = [
      { type: "userMessage", id: "user" },
      { type: "commandExecution", id: "tool" },
      { type: "reasoning", id: "thinking" },
    ];
    expect(selectTurnRenderWindow(turn(thinkingLast)).liveActivityIndexes).toEqual([1, 2]);

    const toolAfterThinking: FakeItem[] = [
      ...thinkingLast,
      { type: "commandExecution", id: "next-tool" },
    ];
    const active = selectTurnRenderWindow(turn(toolAfterThinking));
    expect(active.liveActivityIndexes).toEqual([1, 3]);
    expect(active.collapsedActivityIndexes).toEqual([]);

    const completed = selectTurnRenderWindow(turn(thinkingLast, "completed"));
    expect(completed.collapsedActivityIndexes).toEqual([1]);
  });
});
