import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import { renderHook } from "@testing-library/react-native";
import { useTimelineSearchProjection } from "../src/features/conversation/timeline/timelineSearch";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";

function turn(items: Turn["items"]): TimelineItem {
  return {
    connectionId: "server",
    id: "turn",
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: 2,
      durationMs: 1,
      error: null,
      id: "turn",
      items,
      itemsView: "full",
      startedAt: 1,
      status: "completed",
    },
  };
}

const timeline = [
  turn([
    {
      content: [{ text: "Run the deploy", text_elements: [], type: "text" }],
      id: "prompt",
      type: "userMessage",
    },
    {
      aggregatedOutput: "token-in-tool-output",
      command: "deploy --verbose",
      commandActions: [],
      cwd: "/workspace",
      durationMs: 10,
      exitCode: 0,
      id: "command",
      processId: null,
      source: "agent",
      status: "completed",
      type: "commandExecution",
    },
    {
      id: "progress",
      phase: "commentary",
      text: "Halfway through the deploy",
      type: "agentMessage",
    },
    { id: "answer", phase: "final_answer", text: "Deployed", type: "agentMessage" },
  ] as Turn["items"]),
];

function matches(query: string): number {
  const { result } = renderHook(() => useTimelineSearchProjection(query, timeline));
  return result.current.threadSearchMatches.length;
}

it("searches what the person and the agent wrote, never a tool call or its output", () => {
  expect(matches("Run the deploy")).toBe(1);
  expect(matches("Halfway")).toBe(1);
  expect(matches("Deployed")).toBe(1);
  expect(matches("token-in-tool-output")).toBe(0);
  expect(matches("--verbose")).toBe(0);
  expect(matches("commandExecution")).toBe(0);
});
