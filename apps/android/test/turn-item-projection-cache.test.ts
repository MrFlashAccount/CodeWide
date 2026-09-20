import { describe, expect, it } from "vitest";

import {
  projectThreadItem,
  projectTurnProjection,
} from "../src/features/conversation/turns/turnProjection";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";

type TurnRow = Extract<TimelineItem, { kind: "turn" }>;
type RawTurnItem = Parameters<typeof projectThreadItem>[1];

function rawItem(id: string, output: string): RawTurnItem {
  const value: unknown = {
    aggregatedOutput: output,
    command: "pnpm test",
    durationMs: null,
    id,
    status: "inProgress",
    type: "commandExecution",
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed through a safe typed helper while supplying only the fields this renderer reads.
  return value as RawTurnItem;
}

function turnRow(items: RawTurnItem[]): TurnRow {
  const value: unknown = {
    connectionId: "server",
    id: "turn-1",
    key: "server/thread/turn-1",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      id: "turn-1",
      items,
      startedAt: 1,
      status: "inProgress",
    },
  };
  // WHY: TimelineItem has no narrow test factory, so the fixture cannot be constructed through a
  // safe typed helper while supplying only the fields consumed by this projection.
  return value as TurnRow;
}

describe("active turn item projection cache", () => {
  it("reuses unchanged render blocks when another tool arrives", () => {
    const firstTool = rawItem("tool-1", "first");
    const secondTool = rawItem("tool-2", "second");
    const before = projectTurnProjection(turnRow([firstTool]));
    const after = projectTurnProjection(turnRow([firstTool, secondTool]));

    expect(after.liveActivityBlocks[0]).toBe(before.liveActivityBlocks[0]);
  });

  it("reprojects the one item whose payload changed", () => {
    const first = rawItem("tool-1", "partial");
    const updated = rawItem("tool-1", "complete");

    expect(projectThreadItem(turnRow([first]), first, 0)).not.toBe(
      projectThreadItem(turnRow([updated]), updated, 0),
    );
  });
});
