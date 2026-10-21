import { describe, expect, it } from "vitest";

import { INTEREST_TOPIC_PATCHES } from "../src/data/thread-summary-projection";
import { THREAD_LIST_STREAM_CONTRACT } from "../src/data/threadListRow";

// Protects the paired-release contract: Companion filters deliveries by these
// kinds and bounds and frames list rows by these names, so the device summary,
// the list-stream adapter and native validation must use the same values.
//
// New and changed keys are pinned to the approved thread-list stream contract
// literals instead of contract/v1.json, so this device branch verifies itself;
// the paired integration step compares contract/v1.json with the same literals.
const SYNC_INTEREST_TOPIC_KINDS = [
  "itemTextDelta",
  "reasoningDelta",
  "reasoningPart",
  "turnPlan",
  "turnDiff",
  "fileChanges",
  "mcpProgress",
  "tokenUsage",
  "threadProgress",
  "itemUpsert",
];
const THREAD_LIST_STREAM = {
  controlFrame: "listStream",
  frame: "threadListRows",
  helloField: "listStream",
  maxRowsPerFrame: 100,
  rowField: "codewideList",
};

describe("sync interest and thread-list stream contract", () => {
  it("keeps the device topic kinds equal to the approved syncInterest kinds", () => {
    expect(INTEREST_TOPIC_PATCHES).toEqual(new Set(SYNC_INTEREST_TOPIC_KINDS));
  });

  it("keeps the JS adapter and native frame owner on the approved threadListStream literals", () => {
    expect(THREAD_LIST_STREAM_CONTRACT).toEqual(THREAD_LIST_STREAM);
  });
});
