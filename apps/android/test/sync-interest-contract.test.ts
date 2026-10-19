import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

function readUnchangedInterestLimits(): { maxInterestThreads: unknown; maxThreadIdChars: unknown } {
  const contractPath = resolve(
    import.meta.dirname,
    "../../../crates/companion-core/contract/v1.json",
  );
  const contract: unknown = JSON.parse(readFileSync(contractPath, "utf8"));
  if (
    contract === null ||
    typeof contract !== "object" ||
    !("syncInterest" in contract) ||
    contract.syncInterest === null ||
    typeof contract.syncInterest !== "object" ||
    !("maxInterestThreads" in contract.syncInterest) ||
    !("maxThreadIdChars" in contract.syncInterest)
  ) {
    throw new Error("Companion syncInterest contract is invalid");
  }
  return {
    maxInterestThreads: contract.syncInterest.maxInterestThreads,
    maxThreadIdChars: contract.syncInterest.maxThreadIdChars,
  };
}

function readKotlinConstants(file: string, owner: string): Map<string, number | string> {
  const kotlin = readFileSync(
    resolve(import.meta.dirname, `../android/app/src/main/java/dev/codewide/app/remote/${file}`),
    "utf8",
  );
  const body = new RegExp(`internal object ${owner} \\{(?<body>[^}]*)`, "u").exec(kotlin)?.groups
    ?.body;
  if (body === undefined) {
    throw new Error(`Kotlin ${owner} owner was not found`);
  }
  const constants = new Map<string, number | string>();
  for (const match of body.matchAll(/const val ([A-Z_]+) = (?:"([^"]*)"|([0-9_]+))/gu)) {
    const [, name, text, number] = match;
    if (name === undefined || (text === undefined && number === undefined)) {
      throw new Error("Kotlin constant parser returned an incomplete match");
    }
    constants.set(name, text ?? Number(number?.replaceAll("_", "")));
  }
  return constants;
}

describe("sync interest and thread-list stream contract", () => {
  it("keeps the device topic kinds equal to the approved syncInterest kinds", () => {
    expect(INTEREST_TOPIC_PATCHES).toEqual(new Set(SYNC_INTEREST_TOPIC_KINDS));
  });

  it("keeps the native interest bounds equal to the unchanged contract keys", () => {
    const limits = readUnchangedInterestLimits();
    expect(readKotlinConstants("NativeSyncInterest.kt", "NativeSyncInterest")).toEqual(
      new Map([
        ["MAX_INTEREST_THREADS", limits.maxInterestThreads],
        ["MAX_INTEREST_THREAD_ID_CHARS", limits.maxThreadIdChars],
      ]),
    );
  });

  it("keeps the JS adapter and native frame owner on the approved threadListStream literals", () => {
    expect(THREAD_LIST_STREAM_CONTRACT).toEqual(THREAD_LIST_STREAM);
    expect(readKotlinConstants("NativeListStream.kt", "NativeListStream")).toEqual(
      new Map<string, number | string>([
        ["FRAME", THREAD_LIST_STREAM.frame],
        ["CONTROL_FRAME", THREAD_LIST_STREAM.controlFrame],
        ["HELLO_FIELD", THREAD_LIST_STREAM.helloField],
        ["ROW_FIELD", THREAD_LIST_STREAM.rowField],
        ["MAX_ROWS_PER_FRAME", THREAD_LIST_STREAM.maxRowsPerFrame],
      ]),
    );
  });
});
