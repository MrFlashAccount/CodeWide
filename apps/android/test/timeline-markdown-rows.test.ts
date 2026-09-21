import { describe, expect, it } from "vitest";
import {
  projectTimelineRows,
  timelineRowKey,
} from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";

type TurnRow = Extract<TimelineItem, { kind: "turn" }>;

const LARGE_MARKDOWN = Array.from(
  { length: 56 },
  (_, index) => `## Section ${String(index)}

This is a deliberately long paragraph for the virtualized conversation Markdown experiment. It contains enough words to wrap across several lines while preserving the ordinary rich Markdown presentation.

| Signal | Value |
| --- | --- |
| section | ${String(index)} |

\`\`\`ts
const section${String(index)} = "stable";
\`\`\`
`,
).join("\n");

function turnRow(id: string, source: string, status: "completed" | "inProgress" = "completed") {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: status === "completed" ? 2 : null,
      durationMs: status === "completed" ? 1 : null,
      id,
      items: [{ id: `${id}-agent`, phase: "final_answer", text: source, type: "agentMessage" }],
      startedAt: 1,
      status,
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnRow;
}

function streamingTurnRow(id: string, items: readonly unknown[]): TurnRow {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      id,
      items,
      startedAt: 1,
      status: "inProgress",
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnRow;
}

const enabled = {
  enabled: true,
  latestUnreadAgentTurnId: null,
  searchMessageItemId: null,
  threadSearchActive: false,
};

describe("feature-flagged conversation rows", () => {
  it("keeps the ordinary renderer when the feature flag is disabled", () => {
    const item = turnRow("large", LARGE_MARKDOWN);
    expect(
      projectTimelineRows([item], {
        ...enabled,
        enabled: false,
      }),
    ).toMatchObject([{ item, kind: "item", timelineIndex: 0 }]);
  });

  it("uses the unified model for a short response", () => {
    const item = turnRow("short", "Short response");
    const rows = projectTimelineRows([item], enabled);

    expect(rows).toMatchObject([
      {
        item,
        kind: "turnSlice",
        parts: [{ kind: "markdownBlock" }],
        placement: "single",
      },
    ]);
  });

  it("splits a stable full-width response and preserves one semantic turn", () => {
    const item = turnRow("large", LARGE_MARKDOWN);
    const rows = projectTimelineRows([item], enabled);

    expect(rows.length).toBeGreaterThan(8);
    expect(rows[0]).toMatchObject({ item, kind: "turnSlice", placement: "start" });
    expect(rows.at(-1)).toMatchObject({ item, kind: "turnSlice", placement: "end" });
    expect(new Set(rows.map((row) => row.timelineIndex))).toEqual(new Set([0]));
  });

  it("uses the same model for search, unread and streaming turns", () => {
    const completed = turnRow("completed", LARGE_MARKDOWN);
    const streaming = turnRow("streaming", LARGE_MARKDOWN, "inProgress");

    expect(
      projectTimelineRows([completed], { ...enabled, threadSearchActive: true }),
    ).toMatchObject([{ kind: "turnSlice", placement: "single" }]);
    expect(
      projectTimelineRows([completed], {
        ...enabled,
        latestUnreadAgentTurnId: completed.id,
      }),
    ).toMatchObject([{ kind: "turnSlice", placement: "single" }]);
    expect(projectTimelineRows([streaming], enabled)).toMatchObject([
      { kind: "turnSlice", placement: "single" },
    ]);
  });

  it("preserves unchanged row identity across outer timeline snapshots", () => {
    const stable = turnRow("stable", "Stable response");
    const changing = turnRow("changing", "First response");
    const first = projectTimelineRows([stable, changing], enabled);
    const second = projectTimelineRows([stable, turnRow("changing", "Updated response")], enabled);

    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
  });

  it("keeps the physical row key stable when a streaming message gains a tool call", () => {
    const userMessage = {
      clientId: null,
      content: [{ text: "Run the tests", text_elements: [], type: "text" }],
      id: "user-1",
      type: "userMessage",
    };
    const agentMessage = {
      id: "agent-1",
      memoryCitation: null,
      phase: "commentary",
      text: "Working",
      type: "agentMessage",
    };
    const toolCall = {
      aggregatedOutput: "",
      command: "pnpm test",
      durationMs: null,
      id: "tool-1",
      status: "inProgress",
      type: "commandExecution",
    };
    const before = projectTimelineRows(
      [streamingTurnRow("streaming-with-tool", [userMessage, agentMessage])],
      enabled,
    );
    const after = projectTimelineRows(
      [streamingTurnRow("streaming-with-tool", [userMessage, agentMessage, toolCall])],
      enabled,
    );

    expect(before).toMatchObject([
      { kind: "turnSlice", parts: [{ kind: "markdownBlock" }], placement: "single" },
    ]);
    expect(after).toMatchObject([
      {
        kind: "turnSlice",
        parts: [{ kind: "markdownBlock" }, { kind: "activity" }],
        placement: "single",
      },
    ]);
    const beforeRow = before[0];
    const afterRow = after[0];
    if (beforeRow === undefined || afterRow === undefined) {
      throw new Error("Expected one projected row before and after the streaming update");
    }
    expect(timelineRowKey(afterRow)).toBe(timelineRowKey(beforeRow));
  });

  it("reprojects a stable item when pagination changes its timeline index", () => {
    const prepended = turnRow("prepended", "Earlier response");
    const stable = turnRow("stable-index", "Stable response");
    const before = projectTimelineRows([stable], enabled);
    const after = projectTimelineRows([prepended, stable], enabled);

    expect(after[1]).not.toBe(before[0]);
    expect(after[1]?.timelineIndex).toBe(1);
  });
});
