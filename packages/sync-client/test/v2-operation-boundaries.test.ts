import { describe, expect, it } from "vitest";

import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  SyncV2CommandDurableUnsettledError,
  SyncV2CommandNotCreatedError,
  SyncV2Session,
  V2_OPERATION_RECEIPT_MAX_AGE_MS,
  type V2Command,
  type V2PersistedOperation,
} from "../src/v2/index.js";
import { FakeV2Socket, makeLive, savedServerA, snapshot, waitFor } from "./v2-fixtures.js";

describe("Sync V2 operation retry boundary", () => {
  it("keeps validation errors fixed and content-free", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setupSession(operations);
    await makeLive(socket, session);

    const failure = await session
      .command("invalid-operation", { kind: "unknown.command" } as unknown as V2Command)
      .catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(SyncV2CommandNotCreatedError);
    expect((failure as Error).message).toBe("Sync V2 command was not durably created");
    expect((failure as Error).message).not.toContain("threadId");
    session.stop();
  });

  it("reports notCreated only after a failed create is followed by a proven absent read", async () => {
    const operations = new CreateFailureStore("before");
    const { socket, session } = setupSession(operations);
    await makeLive(socket, session);

    await expect(
      session.command("before-create", { kind: "thread.delete", threadId: "thread-1" }),
    ).rejects.toBeInstanceOf(SyncV2CommandNotCreatedError);
    expect(await operations.get(savedServerA, "before-create")).toBeNull();
    session.stop();
  });

  it("keeps a commit-then-error and operation-id conflict non-retryable", async () => {
    const commitFailure = new CreateFailureStore("after");
    const first = setupSession(commitFailure);
    await makeLive(first.socket, first.session);
    await expect(
      first.session.command("after-create", { kind: "thread.delete", threadId: "thread-1" }),
    ).rejects.toBeInstanceOf(SyncV2CommandDurableUnsettledError);
    expect(await commitFailure.get(savedServerA, "after-create")).not.toBeNull();
    first.session.stop();

    const conflict = new MemoryV2OperationStore();
    await conflict.create(savedServerA, "conflict", {
      kind: "thread.delete",
      threadId: "original",
    });
    const second = setupSession(conflict);
    await makeLive(second.socket, second.session);
    await expect(
      second.session.command("conflict", { kind: "thread.delete", threadId: "different" }),
    ).rejects.toBeInstanceOf(SyncV2CommandDurableUnsettledError);
    second.session.stop();
  });

  it("never prunes a recoverable operation at the terminal receipt horizon", async () => {
    const operations = new MemoryV2OperationStore();
    await operations.create(
      savedServerA,
      "recoverable",
      { kind: "thread.delete", threadId: "thread-1" },
      0,
    );
    await operations.prune(savedServerA, V2_OPERATION_RECEIPT_MAX_AGE_MS + 1);
    expect(await operations.get(savedServerA, "recoverable")).toMatchObject({ state: "created" });
  });

  it("settles an accepted operation whose authoritative receipt expired", async () => {
    const operations = new MemoryV2OperationStore();
    const sockets = [new FakeV2Socket(), new FakeV2Socket()];
    let socketIndex = 0;
    const session = new SyncV2Session({
      intent: { catalog: { activeLimit: 2, archivedLimit: 1 }, currentThread: null },
      operationStore: operations,
      projectionStore: new MemoryV2ProjectionStore(),
      reconnectDelayMs: 0,
      savedServerId: savedServerA,
      transportLease: { openSync: () => sockets[socketIndex++]! },
    });
    await makeLive(sockets[0]!, session);
    const terminal = session.command("expired-after-acceptance", {
      kind: "thread.delete",
      threadId: "thread-1",
    });
    await waitFor(() => sockets[0]!.sent.some((frame) => frame.type === "command"));
    const sent = sockets[0]!.sent.find((frame) => frame.type === "command");
    sockets[0]!.emit({
      acceptedAt: "2026-08-30T20:00:00Z",
      operationId: "expired-after-acceptance",
      requestId: sent?.requestId,
      type: "commandAccepted",
    });
    await waitFor(
      async () =>
        (await operations.get(savedServerA, "expired-after-acceptance"))?.state === "accepted",
    );

    session.reconnect();
    await waitFor(() => sockets[1]!.listenerCount("open") > 0);
    sockets[1]!.open();
    const next = snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" });
    sockets[1]!.emit(next);
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "snapshotCommitted"));
    sockets[1]!.emit({ type: "live", epochId: next.epochId, watermark: next.watermark });
    await waitFor(() => sockets[1]!.sent.some((frame) => frame.type === "query"));
    const query = sockets[1]!.sent.find((frame) => frame.type === "query");
    sockets[1]!.emit({
      requestId: query?.requestId,
      result: {
        kind: "operation.get",
        operationId: "expired-after-acceptance",
        receipt: {
          acceptedAt: "2026-08-30T20:00:00Z",
          state: "expired",
          terminal: "failed",
        },
      },
      type: "queryCompleted",
    });

    await expect(terminal).resolves.toMatchObject({
      operationId: "expired-after-acceptance",
      type: "commandExpired",
    });
    expect(await operations.get(savedServerA, "expired-after-acceptance")).toMatchObject({
      state: "expired",
    });
    session.stop();
  });
});

class CreateFailureStore extends MemoryV2OperationStore {
  readonly #point: "before" | "after";

  constructor(point: "before" | "after") {
    super();
    this.#point = point;
  }

  override async create(
    ...parameters: Parameters<MemoryV2OperationStore["create"]>
  ): Promise<V2PersistedOperation> {
    if (this.#point === "before") throw new Error("store unavailable before commit");
    await super.create(...parameters);
    throw new Error("commit acknowledgement lost");
  }
}

function setupSession(operations: MemoryV2OperationStore): {
  session: SyncV2Session;
  socket: FakeV2Socket;
} {
  const socket = new FakeV2Socket();
  return {
    session: new SyncV2Session({
      intent: { catalog: { activeLimit: 2, archivedLimit: 1 }, currentThread: null },
      operationStore: operations,
      projectionStore: new MemoryV2ProjectionStore(),
      reconnectDelayMs: 0,
      savedServerId: savedServerA,
      transportLease: { openSync: () => socket },
    }),
    socket,
  };
}
