import { describe, expect, it, vi } from "vitest";

import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  MemoryV2SavedServerDeletionStore,
  v2SavedServerId,
  type V2ProjectionStore,
} from "@codewide/sync-client";

vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => { throw new Error("test injects durable stores"); },
}));
vi.mock("../src/native/native-transport.native", () => ({
  mintNativeSession: vi.fn(),
  nativeCompanionHttpOrigin: vi.fn(),
}));

import { createNativeSyncV2Lifecycle } from "../src/native/sync-v2-lifecycle.native";
import { mintNativeSession, nativeCompanionHttpOrigin, type NativeConnectionConfig } from "../src/native/native-transport.native";

const PIN_A = `sha256/${"A".repeat(43)}=`;
const PIN_B = `sha256/${"B".repeat(43)}=`;
const DEVICE_A = `device-${"a".repeat(64)}`;
const DEVICE_B = `device-${"b".repeat(64)}`;

describe("native Sync V2 saved-server lifecycle", () => {
  it("restarts authentication on credential changes without mutating the saved-server partition", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    const starts: string[] = [];
    const stops: string[] = [];
    const lifecycle = createNativeSyncV2Lifecycle({
      enabled: true,
      projectionStore: projections,
      operationStore: operations,
      deletionStore: new MemoryV2SavedServerDeletionStore(),
      sessionFactory: (config) => ({
        start: () => starts.push(`${config.savedServerId}:${config.deviceId}`),
        stop: () => stops.push(`${config.savedServerId}:${config.deviceId}`),
      }),
    });
    const id = v2SavedServerId("saved-server-a");
    await projections.commitSnapshot(id, snapshot());
    await operations.create(id, "operation", { kind: "thread.delete", threadId: "thread" });

    await lifecycle.reconcile([config("saved-server-a", PIN_A, DEVICE_A)]);
    await lifecycle.reconcile([config("saved-server-a", PIN_B, DEVICE_B)]);

    expect(starts).toEqual([`saved-server-a:${DEVICE_A}`, `saved-server-a:${DEVICE_B}`]);
    expect(stops).toEqual([`saved-server-a:${DEVICE_A}`]);
    expect(await projections.active(id)).not.toBeNull();
    expect(await operations.get(id, "operation")).not.toBeNull();
  });

  it("treats config order and disablement as session selection only", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    let starts = 0;
    let stops = 0;
    const lifecycle = createNativeSyncV2Lifecycle({
      enabled: true,
      projectionStore: projections,
      operationStore: operations,
      deletionStore: new MemoryV2SavedServerDeletionStore(),
      sessionFactory: () => ({ start: () => { starts += 1; }, stop: () => { stops += 1; } }),
    });
    const a = config("saved-server-a", PIN_A, DEVICE_A);
    const b = config("saved-server-b", PIN_B, DEVICE_B);
    await lifecycle.reconcile([a, b]);
    await lifecycle.reconcile([b, a]);
    await lifecycle.reconcile([{ ...a, enabled: false }, b]);
    expect({ starts, stops }).toEqual({ starts: 2, stops: 1 });
  });

  it("purges every V2 row only on explicit saved-server deletion", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    const lifecycle = createNativeSyncV2Lifecycle({
      enabled: false,
      projectionStore: projections,
      operationStore: operations,
      deletionStore: new MemoryV2SavedServerDeletionStore(),
    });
    const a = v2SavedServerId("saved-server-a");
    const b = v2SavedServerId("saved-server-b");
    await projections.commitSnapshot(a, snapshot());
    await projections.commitSnapshot(b, { ...snapshot(), epochId: "epoch-b", revision: "sync-v2-revision:b" });
    await operations.create(a, "same", { kind: "thread.delete", threadId: "a" });
    await operations.create(b, "same", { kind: "thread.delete", threadId: "b" });

    await lifecycle.deleteSavedServer("saved-server-a");

    expect(await projections.active(a)).toBeNull();
    expect(await operations.get(a, "same")).toBeNull();
    expect(await projections.active(b)).not.toBeNull();
    expect(await operations.get(b, "same")).not.toBeNull();
  });

  it("fails closed for legacy credentials without the authoritative paired device id", async () => {
    let starts = 0;
    const lifecycle = createNativeSyncV2Lifecycle({
      enabled: true,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      deletionStore: new MemoryV2SavedServerDeletionStore(),
      sessionFactory: () => ({ start: () => { starts += 1; }, stop: () => undefined }),
    });
    await lifecycle.reconcile([{ ...config("saved-server-a", PIN_A, DEVICE_A), deviceId: null }]);
    expect(starts).toBe(0);
  });

  it("constructs the production V2 WebSocket through the pinned native proxy with a fresh native session", async () => {
    const created: Array<{ url: string; options: { headers: Record<string, string> } }> = [];
    class TestWebSocket {
      readonly readyState = 0;
      constructor(url: string, _protocols: string[], options: { headers: Record<string, string> }) {
        created.push({ url, options });
      }
      addEventListener(): void {}
      send(): void {}
      close(): void {}
    }
    vi.stubGlobal("WebSocket", TestWebSocket);
    vi.mocked(nativeCompanionHttpOrigin).mockResolvedValue("http://127.0.0.1:4242");
    vi.mocked(mintNativeSession).mockResolvedValue({ sessionToken: "session-proof", expiresAt: Date.now() + 60_000 });
    const lifecycle = createNativeSyncV2Lifecycle({
      enabled: true,
      projectionStore: new MemoryV2ProjectionStore(),
      operationStore: new MemoryV2OperationStore(),
      deletionStore: new MemoryV2SavedServerDeletionStore(),
    });

    await lifecycle.reconcile([config("saved-server-a", PIN_A, DEVICE_A)]);
    await vi.waitFor(() => expect(created).toHaveLength(1));

    expect(nativeCompanionHttpOrigin).toHaveBeenCalledWith("saved-server-a", "wss://example.test/v1/sync");
    expect(mintNativeSession).toHaveBeenCalledWith("saved-server-a");
    expect(created[0]).toEqual({
      url: "ws://127.0.0.1:4242/v2/sync",
      options: { headers: { Authorization: "Bearer session-proof" } },
    });
    lifecycle.stop();
    vi.unstubAllGlobals();
  });

  it("keeps deletion durably blocked across partial purge failure, restart, and safe retry", async () => {
    const baseProjections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    const deletions = new MemoryV2SavedServerDeletionStore();
    const id = v2SavedServerId("saved-server-a");
    await baseProjections.commitSnapshot(id, snapshot());
    await operations.create(id, "operation", { kind: "thread.delete", threadId: "thread" });
    let failProjectionDelete = true;
    const projections: V2ProjectionStore = {
      active: (savedServerId) => baseProjections.active(savedServerId),
      commitSnapshot: (savedServerId, value, signal) => baseProjections.commitSnapshot(savedServerId, value, signal),
      applyChange: (savedServerId, epochId, watermark, change) => baseProjections.applyChange(savedServerId, epochId, watermark, change),
      abandonEpoch: (savedServerId, epochId) => baseProjections.abandonEpoch(savedServerId, epochId),
      hasSavedServerData: (savedServerId) => baseProjections.hasSavedServerData(savedServerId),
      deleteSavedServer: async (savedServerId) => {
        if (failProjectionDelete) throw new Error("injected projection purge failure");
        await baseProjections.deleteSavedServer(savedServerId);
      },
    };
    const credentialsDelete = vi.fn(async () => undefined);
    const firstStarts = vi.fn();
    const first = createNativeSyncV2Lifecycle({
      enabled: true,
      projectionStore: projections,
      operationStore: operations,
      deletionStore: deletions,
      sessionFactory: () => ({ start: firstStarts, stop: vi.fn() }),
    });
    await first.reconcile([config("saved-server-a", PIN_A, DEVICE_A)]);
    await expect(first.deleteSavedServer("saved-server-a", credentialsDelete)).rejects.toThrow("remains blocked");
    expect(credentialsDelete).not.toHaveBeenCalled();
    expect(await deletions.pending(id)).toBe(true);
    expect(await baseProjections.hasSavedServerData(id)).toBe(true);
    expect(await operations.hasSavedServerData(id)).toBe(false);

    const restartStarts = vi.fn();
    const restarted = createNativeSyncV2Lifecycle({
      enabled: true,
      projectionStore: projections,
      operationStore: operations,
      deletionStore: deletions,
      sessionFactory: () => ({ start: restartStarts, stop: vi.fn() }),
    });
    await restarted.reconcile([config("saved-server-a", PIN_A, DEVICE_A)]);
    expect(restartStarts).not.toHaveBeenCalled();

    failProjectionDelete = false;
    await restarted.deleteSavedServer("saved-server-a", credentialsDelete);
    expect(credentialsDelete).toHaveBeenCalledOnce();
    expect(await deletions.pending(id)).toBe(false);
    expect(await baseProjections.hasSavedServerData(id)).toBe(false);

    await restarted.reconcile([config("saved-server-a", PIN_A, DEVICE_A)]);
    expect(restartStarts).toHaveBeenCalledOnce();
  });
});

function config(savedServerId: string, tlsPinSha256: string, deviceId: string): NativeConnectionConfig {
  return { connectionId: savedServerId, savedServerId, endpoint: "wss://example.test/v1/sync", tlsPinSha256, enabled: true, deviceId };
}

function snapshot() {
  return {
    type: "snapshot" as const,
    version: 2 as const,
    epochId: "epoch-a",
    revision: "sync-v2-revision:a",
    watermark: "0",
    scope: { active: { limit: 2, returned: 0, complete: true }, archived: { limit: 1, returned: 0, complete: true } },
    catalog: { active: [], archived: [] },
    currentThread: null,
    pendingRequests: [],
    includedTail: [],
    limits: { catalogPerPartitionMax: 100, turnWindowMax: 36, historyPageMax: 100, queueMaxEvents: 2_048, queueMaxBytes: 4_194_304, snapshotMaxBytes: 8_388_608 },
  };
}
