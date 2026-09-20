import { describe, expect, it, vi } from "vitest";

import {
  createGlobalSupervisorBindingOwner,
  GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX,
  parseGlobalSupervisorBinding,
  type GlobalSupervisorBinding,
  type GlobalSupervisorBindingDatabase,
} from "../src/data/globalSupervisorBinding";

function stored(value: unknown): GlobalSupervisorBinding {
  const parsed = parseGlobalSupervisorBinding(value);
  if (parsed === null) {
    throw new Error("Invalid binding test fixture");
  }
  return parsed;
}

function database(initial: GlobalSupervisorBinding | null = null): {
  readonly database: GlobalSupervisorBindingDatabase;
  readonly writes: GlobalSupervisorBinding[];
} {
  let current = initial;
  const writes: GlobalSupervisorBinding[] = [];
  return {
    database: {
      async clear() {
        current = null;
      },
      async read() {
        return current;
      },
      ready: Promise.resolve(),
      async write(binding) {
        current = binding;
        writes.push(binding);
      },
    },
    writes,
  };
}

describe("GlobalSupervisorBindingOwner", () => {
  it("persists creating before starting and then commits the exact qualified home", async () => {
    const storage = database();
    const startThread = vi.fn(async () => {
      expect(storage.writes).toEqual([
        {
          creationToken: "creation-token",
          homeConnectionId: "server-a",
          schemaVersion: 1,
          status: "creating",
        },
      ]);
      return "thread-a";
    });
    const owner = createGlobalSupervisorBindingOwner({
      database: storage.database,
      randomUUID: () => "creation-token",
      remote: { findThreadsBySource: vi.fn(async () => []), startThread },
    });

    await expect(owner.bind("server-a")).resolves.toEqual({
      connectionId: "server-a",
      threadId: "thread-a",
    });
    expect(startThread).toHaveBeenCalledWith(
      "server-a",
      `${GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX}creation-token`,
    );
    expect(storage.writes.at(-1)).toEqual({
      home: { connectionId: "server-a", threadId: "thread-a" },
      schemaVersion: 1,
      status: "ready",
    });
  });

  it("recovers a crash after thread creation by matching only the exact source token", async () => {
    const storage = database(
      stored({
        creationToken: "existing-token",
        homeConnectionId: "server-a",
        schemaVersion: 1,
        status: "creating",
      }),
    );
    const findThreadsBySource = vi.fn(async () => ["existing-thread"]);
    const startThread = vi.fn(async () => "unexpected-thread");
    const owner = createGlobalSupervisorBindingOwner({
      database: storage.database,
      randomUUID: () => "new-token",
      remote: { findThreadsBySource, startThread },
    });

    await expect(owner.reconcile()).resolves.toEqual({
      home: { connectionId: "server-a", threadId: "existing-thread" },
      schemaVersion: 1,
      status: "ready",
    });
    expect(findThreadsBySource).toHaveBeenCalledWith(
      "server-a",
      `${GLOBAL_SUPERVISOR_THREAD_SOURCE_PREFIX}existing-token`,
    );
    expect(startThread).not.toHaveBeenCalled();
  });

  it("invalidates the exact binding when its saved server is deleted", async () => {
    const storage = database(
      stored({
        home: { connectionId: "server-a", threadId: "thread-a" },
        schemaVersion: 1,
        status: "ready",
      }),
    );
    const owner = createGlobalSupervisorBindingOwner({
      database: storage.database,
      randomUUID: () => "token",
      remote: {
        findThreadsBySource: vi.fn(async () => []),
        startThread: vi.fn(async () => "thread"),
      },
    });

    await owner.invalidateDeletedConnections(new Set(["server-b"]));
    await expect(owner.read()).resolves.toEqual({
      priorHome: { connectionId: "server-a", threadId: "thread-a" },
      reason: "homeDeleted",
      schemaVersion: 1,
      status: "invalid",
    });
  });

  it("never replaces a ready binding when another home is requested", async () => {
    const storage = database(
      stored({
        home: { connectionId: "server-a", threadId: "thread-a" },
        schemaVersion: 1,
        status: "ready",
      }),
    );
    const startThread = vi.fn(async () => "replacement-thread");
    const owner = createGlobalSupervisorBindingOwner({
      database: storage.database,
      randomUUID: () => "token",
      remote: { findThreadsBySource: vi.fn(async () => []), startThread },
    });

    await expect(owner.bind("server-b")).rejects.toThrow("already bound");
    expect(startThread).not.toHaveBeenCalled();
    await expect(owner.read()).resolves.toEqual(
      expect.objectContaining({ home: { connectionId: "server-a", threadId: "thread-a" } }),
    );
  });

  it("keeps an unresolved creating binding sticky and never issues a second start", async () => {
    const storage = database(
      stored({
        creationToken: "existing-token",
        homeConnectionId: "server-a",
        schemaVersion: 1,
        status: "creating",
      }),
    );
    const startThread = vi.fn(async () => "replacement-thread");
    const owner = createGlobalSupervisorBindingOwner({
      database: storage.database,
      randomUUID: () => "new-token",
      remote: { findThreadsBySource: vi.fn(async () => []), startThread },
    });

    await expect(owner.bind("server-a")).rejects.toThrow("explicit reconciliation");
    expect(startThread).not.toHaveBeenCalled();
    await expect(owner.read()).resolves.toEqual(
      expect.objectContaining({ creationToken: "existing-token", status: "creating" }),
    );
  });
});
