import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  type SyncV2Session,
  type SyncV2SessionSnapshot,
} from "@codewide/sync-client/v2";
import { describe, expect, it, vi } from "vitest";

import { SyncSessionRegistry } from "../src/v2/infrastructure/sync/syncSessionRegistry";

const EMPTY: SyncV2SessionSnapshot = {
  operations: [],
  projections: { live: null, retained: null },
  state: "offline",
  version: 0,
};

describe("SyncSessionRegistry", () => {
  it("uses one stable projection authority while changing its current-thread intent", async () => {
    const created: Array<{
      currentThreadId: string | null;
      reconnect: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
      watchThread: ReturnType<typeof vi.fn>;
    }> = [];
    const createSession: NonNullable<ConstructorParameters<typeof SyncSessionRegistry>[2]> = async (
      _savedServerId,
      _projectionStore,
      _operationStore,
      currentThreadId,
    ) => {
      const reconnect = vi.fn();
      const release = vi.fn(async () => undefined);
      const watchThread = vi.fn(async () => undefined);
      const session = {
        reconnect,
        snapshot: async () => EMPTY,
        start: vi.fn(),
        stop: vi.fn(),
        subscribe: () => () => undefined,
        watchThread,
      } as unknown as SyncV2Session;
      created.push({ currentThreadId, reconnect, release, watchThread });
      return { release, session };
    };
    const registry = new SyncSessionRegistry(
      new MemoryV2ProjectionStore(),
      new MemoryV2OperationStore(),
      createSession,
    );

    const catalog = await registry.open("saved-server");
    const firstThread = await registry.open("saved-server", "thread-1");
    expect(firstThread).toBe(catalog);
    expect(await registry.open("saved-server")).toBe(catalog);
    expect(created.map(({ currentThreadId }) => currentThreadId)).toEqual([null]);
    expect(created[0]!.watchThread).toHaveBeenLastCalledWith("thread-1", 36);

    const secondThread = await registry.open("saved-server", "thread-2");
    expect(secondThread).toBe(firstThread);
    expect(created).toHaveLength(1);
    expect(created[0]!.watchThread).toHaveBeenCalledTimes(2);
    expect(created[0]!.watchThread).toHaveBeenLastCalledWith("thread-2", 36);
    expect(created[0]!.reconnect).not.toHaveBeenCalled();
    expect(created[0]!.release).not.toHaveBeenCalled();

    registry.reconnect("saved-server");
    await vi.waitFor(() => {
      expect(created[0]!.reconnect).toHaveBeenCalledOnce();
    });
    await registry.closeAll();
    expect(created[0]!.release).toHaveBeenCalledOnce();
  });
});
