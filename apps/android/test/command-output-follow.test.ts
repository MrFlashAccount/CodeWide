import type { CommandOutputReference } from "@codewide/sync-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[][] = [];
const texts = new Map<string, string>();

// WHY: only the private-content transfer is replaced; the follower's prefix,
// generation and bounding logic run unchanged against segment texts.
vi.mock("../src/rendering/command-output-resource", () => ({
  readCommandOutput: async (request: { references: readonly CommandOutputReference[] }) => {
    reads.push(request.references.map((reference) => reference.id));
    await Promise.resolve();
    return {
      hasMore: false,
      text: request.references.map((reference) => texts.get(reference.id) ?? "").join(""),
    };
  },
}));

const { COMMAND_FOLLOW_RESIDENT_CHARS, followCommandOutput, resetFollowedCommandOutputs } =
  await import("../src/rendering/commandOutputFollow");

function segment(name: string, text: string): CommandOutputReference {
  const id = name.padEnd(64, "0");
  texts.set(id, text);
  return { byteLength: text.length, contentType: "text/plain", encoding: "utf-8", id };
}

function follow(
  references: readonly CommandOutputReference[],
  signal = new AbortController().signal,
) {
  return followCommandOutput({
    getTransferAccess: async () => {
      throw new Error("unused");
    },
    key: "viewer",
    publish: () => undefined,
    references,
    scope: "scope",
    signal,
  });
}

beforeEach(() => {
  reads.length = 0;
  texts.clear();
  resetFollowedCommandOutputs();
});

describe("followCommandOutput", () => {
  it("appends each new segment of a running command without rereading earlier ones", async () => {
    const first = segment("a", "one\n");
    const second = segment("b", "two\n");
    const third = segment("c", "three\n");

    const opened = await follow([first]);
    const grown = await follow([first, second]);
    const again = await follow([first, second, third]);

    expect(opened.text).toBe("one\n");
    expect(grown).toMatchObject({ generation: opened.generation, text: "one\ntwo\n" });
    expect(again).toMatchObject({ generation: opened.generation, text: "one\ntwo\nthree\n" });
    // The terminal appends what totalChars grew by: the new segment exactly.
    expect(again.totalChars - grown.totalChars).toBe("three\n".length);
    expect(reads).toEqual([[first.id], [second.id], [third.id]]);
  });

  it("recovers the complete output after an aborted read", async () => {
    const first = segment("a", "one\n");
    const second = segment("b", "two\n");
    const aborted = new AbortController();
    const pending = follow([first, second], aborted.signal);
    aborted.abort();
    await expect(pending).rejects.toThrow();

    const resumed = await follow([first, second]);

    expect(resumed.text).toBe("one\ntwo\n");
  });

  it("replaces the text in a new generation when the finished item aggregates its output", async () => {
    const first = segment("a", "one\n");
    const second = segment("b", "two\n");
    const live = await follow([first, second]);

    const settled = await follow([segment("z", "one\ntwo\n")]);

    expect(settled.generation).toBeGreaterThan(live.generation);
    expect(settled).toMatchObject({ headOmitted: false, text: "one\ntwo\n", totalChars: 8 });
  });

  it("keeps a live output's newest lines once it grows past the resident bound", async () => {
    const line = `${"x".repeat(1023)}\n`;
    const block = line.repeat(256);
    const segments = Array.from({ length: 6 }, (_, index) => segment(`s${String(index)}`, block));
    await follow(segments.slice(0, 1));
    let output = await follow(segments.slice(0, 2));
    for (let count = 3; count <= segments.length; count += 1) {
      output = await follow(segments.slice(0, count));
    }

    expect(output.headOmitted).toBe(true);
    expect(output.text.length).toBeLessThanOrEqual(COMMAND_FOLLOW_RESIDENT_CHARS);
    expect(output.text.startsWith("x")).toBe(true);
    expect(output.totalChars).toBe(block.length * segments.length);
  });

  it("shows a finished command opened afresh completely, however long", async () => {
    const whole = `${"y".repeat(1023)}\n`.repeat(1536);

    const output = await follow([segment("w", whole)]);

    expect(output).toMatchObject({ headOmitted: false, text: whole });
  });
});
