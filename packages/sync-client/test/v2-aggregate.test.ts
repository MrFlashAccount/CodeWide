import { describe, expect, it } from "vitest";

import {
  MemoryV2ProjectionStore,
  MemoryV2SavedServerDeletionStore,
  SyncV2SessionRouter,
  deriveV2AggregateProjection,
  removeSavedServerFromV2Selection,
  type V2SemanticSession,
} from "../src/v2/index.js";
import { savedServerA, savedServerB, snapshot, thread } from "./v2-fixtures.js";

describe("Sync V2 one, many, and All projection", () => {
  it("keeps identical thread ids distinct and changing selection does not mutate partitions", async () => {
    const store = new MemoryV2ProjectionStore();
    const deletions = new MemoryV2SavedServerDeletionStore();
    await store.commitSnapshot(
      savedServerA,
      snapshot({ active: [thread("same", { title: "A" })] }),
    );
    await store.commitSnapshot(
      savedServerB,
      snapshot({
        epochId: "epoch-b",
        revision: "sync-v2-revision:b",
        active: [thread("same", { title: "B" })],
      }),
    );
    const beforeA = await store.active(savedServerA);
    const beforeB = await store.active(savedServerB);

    const one = await deriveV2AggregateProjection(store, deletions, [savedServerA, savedServerB], {
      kind: "selected",
      savedServerIds: [savedServerA],
    });
    const many = await deriveV2AggregateProjection(store, deletions, [savedServerA, savedServerB], {
      kind: "selected",
      savedServerIds: [savedServerB, savedServerA],
    });
    const all = await deriveV2AggregateProjection(store, deletions, [savedServerA, savedServerB], {
      kind: "all",
    });

    expect(one.threads.map(({ identity }) => identity)).toEqual([
      { savedServerId: savedServerA, threadId: "same" },
    ]);
    expect(
      many.threads.map(({ identity, entry }) => [
        identity.savedServerId,
        identity.threadId,
        entry.thread.title,
      ]),
    ).toEqual([
      [savedServerB, "same", "B"],
      [savedServerA, "same", "A"],
    ]);
    expect(all.servers.map(({ savedServerId }) => savedServerId)).toEqual([
      savedServerA,
      savedServerB,
    ]);
    expect(await store.active(savedServerA)).toEqual(beforeA);
    expect(await store.active(savedServerB)).toEqual(beforeB);
  });

  it("fails aggregate reads closed while saved-server deletion is pending", async () => {
    const store = new MemoryV2ProjectionStore();
    const deletions = new MemoryV2SavedServerDeletionStore();
    await store.commitSnapshot(savedServerA, snapshot({ active: [thread("blocked")] }));
    await store.commitSnapshot(
      savedServerB,
      snapshot({ epochId: "epoch-b", revision: "sync-v2-revision:b", active: [thread("visible")] }),
    );
    await deletions.begin(savedServerA);

    const aggregate = await deriveV2AggregateProjection(
      store,
      deletions,
      [savedServerA, savedServerB],
      { kind: "all" },
    );
    expect(aggregate.servers.map(({ savedServerId }) => savedServerId)).toEqual([savedServerB]);
    expect(await store.hasSavedServerData(savedServerA)).toBe(true);
  });

  it("updates only explicit selection when its saved server is deleted", () => {
    expect(
      removeSavedServerFromV2Selection(
        { kind: "selected", savedServerIds: [savedServerA, savedServerB] },
        savedServerA,
      ),
    ).toEqual({ kind: "selected", savedServerIds: [savedServerB] });
    expect(removeSavedServerFromV2Selection({ kind: "all" }, savedServerA)).toEqual({
      kind: "all",
    });
  });
});

describe("Sync V2 owner routing", () => {
  it("routes queries and equal durable operation ids to the owning server", async () => {
    const calls: string[] = [];
    const router = new SyncV2SessionRouter(new MemoryV2SavedServerDeletionStore());
    router.register(fakeSession(savedServerA, calls));
    router.register(fakeSession(savedServerB, calls));

    await router.query(savedServerB, { kind: "models.list" });
    await router.command(
      { savedServerId: savedServerA, operationId: "same" },
      { kind: "thread.delete", threadId: "thread" },
    );
    await router.command(
      { savedServerId: savedServerB, operationId: "same" },
      { kind: "thread.delete", threadId: "thread" },
    );
    expect(calls).toEqual([
      `${savedServerB}:query:models.list`,
      `${savedServerA}:command:same`,
      `${savedServerB}:command:same`,
    ]);
  });

  it("fails closed when no session owns the target", async () => {
    const router = new SyncV2SessionRouter(new MemoryV2SavedServerDeletionStore());
    await expect(router.query(savedServerA, { kind: "models.list" })).rejects.toThrow(
      "No live Sync V2 session owns",
    );
  });

  it("blocks every semantic route while durable deletion is pending", async () => {
    const deletions = new MemoryV2SavedServerDeletionStore();
    const router = new SyncV2SessionRouter(deletions);
    router.register(fakeSession(savedServerA, []));
    await deletions.begin(savedServerA);
    await expect(router.query(savedServerA, { kind: "models.list" })).rejects.toThrow(
      "blocked by durable deletion intent",
    );
  });
});

function fakeSession(savedServerId: typeof savedServerA, calls: string[]): V2SemanticSession {
  return {
    savedServerId,
    query: async (query) => {
      calls.push(`${savedServerId}:query:${query.kind}`);
      return { kind: "models.list" as const, models: [] };
    },
    command: async (operationId) => {
      calls.push(`${savedServerId}:command:${operationId}`);
      return {
        type: "commandCompleted" as const,
        operationId,
        result: { kind: "thread.delete" as const, threadId: "thread" },
      };
    },
  };
}
