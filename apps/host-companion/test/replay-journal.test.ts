import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ReplayJournal } from "../src/replay-journal.js";

describe("ReplayJournal", () => {
  it("persists monotonic cursors privately and expires only old replay windows", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-replay-"));
    const filePath = path.join(directory, "journal.jsonl");
    const journal = await ReplayJournal.open({ filePath, maxEntries: 3 });
    for (let index = 1; index <= 4; index += 1) {
      await journal.append({ method: "test/event", params: { index } });
    }
    expect(journal.headCursor).toBe(4);
    expect(journal.replay(0)).toEqual({ snapshotRequired: true, headCursor: 4 });
    expect(journal.replay(1)).toMatchObject({
      snapshotRequired: false,
      headCursor: 4,
      entries: [{ cursor: 2 }, { cursor: 3 }, { cursor: 4 }],
    });
    await journal.close();

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    const reopened = await ReplayJournal.open({ filePath, maxEntries: 3 });
    expect(reopened.replay(3)).toMatchObject({
      snapshotRequired: false,
      headCursor: 4,
      entries: [{ cursor: 4 }],
    });
    await reopened.close();
  });

  it("bounds retained replay data by bytes as well as entry count", async () => {
    const journal = await ReplayJournal.open({ maxEntries: 100, maxBytes: 260 });
    for (let index = 0; index < 10; index += 1) {
      await journal.append({ method: "delta", params: { text: `entry-${index}-${"x".repeat(48)}` } });
    }

    const replay = journal.replay(0);
    expect(replay).toMatchObject({ snapshotRequired: true, headCursor: 10 });
    const tail = journal.replay(9);
    expect(tail).toMatchObject({ snapshotRequired: false, headCursor: 10 });
    if (!tail.snapshotRequired) expect(tail.entries.map(({ cursor }) => cursor)).toEqual([10]);
  });

  it("assigns a monotonic cursor range and persists a live batch atomically", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-replay-batch-"));
    const filePath = path.join(directory, "journal.jsonl");
    const journal = await ReplayJournal.open({ filePath });

    const entries = await journal.appendBatch([
      { method: "item/agentMessage/delta", params: { delta: "one" } },
      { method: "item/agentMessage/delta", params: { delta: "two" } },
      { method: "item/completed", params: {} },
    ]);

    expect(entries.map(({ cursor }) => cursor)).toEqual([1, 2, 3]);
    await journal.close();
    const lines = (await readFile(filePath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    const reopened = await ReplayJournal.open({ filePath });
    expect(reopened.replay(0)).toMatchObject({ snapshotRequired: false, headCursor: 3, entries });
    const payloads: Readonly<Record<string, unknown>>[] = [];
    reopened.forEachPayload((payload) => payloads.push(payload));
    expect(payloads).toEqual(entries.map(({ payload }) => payload));
    await reopened.close();
  });

  it("does not duplicate a concurrent append across an async compaction rewrite", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-replay-race-"));
    const filePath = path.join(directory, "journal.jsonl");
    const journal = await ReplayJournal.open({ filePath, maxEntries: 2 });
    await journal.append({ n: 1 });
    await journal.append({ n: 2 });
    await Promise.all([
      journal.append({ n: 3 }),
      journal.append({ n: 4 }),
    ]);
    await journal.close();

    const reopened = await ReplayJournal.open({ filePath, maxEntries: 2 });
    const replay = reopened.replay(2);
    expect(replay).toEqual({
      snapshotRequired: false,
      headCursor: 4,
      entries: [
        { cursor: 3, payload: { n: 3 } },
        { cursor: 4, payload: { n: 4 } },
      ],
    });
    await reopened.close();
  });

  it("fails closed on a corrupt durable journal", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codewide-replay-corrupt-"));
    const filePath = path.join(directory, "journal.jsonl");
    await writeFile(filePath, '{"cursor":2,"payload":{}}\n{"cursor":1,"payload":{}}\n', { mode: 0o600 });
    await expect(ReplayJournal.open({ filePath })).rejects.toThrow("corrupt or non-monotonic");
    expect(await readFile(filePath, "utf8")).toContain('"cursor":2');
  });
});
