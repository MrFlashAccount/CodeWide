import { expect, it } from "vitest";
import { MemoryV2OperationStore, MemoryV2ProjectionStore, SyncV2Session } from "../src/v2/index.js";
import { defaultIntent, FakeV2Socket, makeLive, savedServerA, waitFor } from "./v2-fixtures.js";

it("receives pushed inventory independently, ignores older revisions and clears it on disconnect", async () => {
  const socket = new FakeV2Socket();
  const session = new SyncV2Session({ savedServerId: savedServerA,
    transportLease: { openSync: () => socket },
    intent: { ...defaultIntent, portInventory: true },
    projectionStore: new MemoryV2ProjectionStore(), operationStore: new MemoryV2OperationStore(),
    reconnectDelayMs: 60_000 });
  try {
    await makeLive(socket, session);
    expect(socket.sent[0]).toMatchObject({ intent: { portInventory: true } });
    const inventory = { type: "portInventory", epochId: "epoch-1", revision: "2",
      inventory: { ports: [], scannedAt: 2 } };
    let publications = 0;
    session.portInventory.subscribe(() => { throw new Error("consumer failed"); });
    session.portInventory.subscribe(() => { publications += 1; });
    socket.emit(inventory);
    expect(session.portInventory.getSnapshot()).toEqual(inventory);
    socket.emit({ ...inventory, revision: "1" });
    expect(publications).toBe(1);
    expect(session.state).toBe("live");
    socket.close();
    await waitFor(() => session.portInventory.getSnapshot() === null);
  } finally { await session.dispose(); }
});

it("rejects an inventory from another connection epoch", async () => {
  const socket = new FakeV2Socket();
  const session = new SyncV2Session({ savedServerId: savedServerA,
    transportLease: { openSync: () => socket }, intent: { ...defaultIntent, portInventory: true },
    projectionStore: new MemoryV2ProjectionStore(), operationStore: new MemoryV2OperationStore(),
    reconnectDelayMs: 60_000 });
  try {
    await makeLive(socket, session);
    socket.emit({ type: "portInventory", epochId: "old-epoch", revision: "1",
      inventory: { ports: [], scannedAt: 1 } });
    expect(session.portInventory.getSnapshot()).toBeNull();
    expect(socket.closes.length).toBeGreaterThan(0);
  } finally { await session.dispose(); }
});
