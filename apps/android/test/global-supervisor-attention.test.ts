import { describe, expect, it, vi } from "vitest";

import {
  createGlobalSupervisorAttentionOwner,
  GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX,
} from "../src/data/globalSupervisorAttention";
import { createGlobalSupervisorAttentionDeliverySession } from "../src/data/globalSupervisorAttentionDelivery";
import { createGlobalSupervisorAttentionProjection } from "../src/data/globalSupervisorAttentionProjection";
import { createGlobalSupervisorAttentionStorage } from "../src/data/globalSupervisorAttentionStorage.web";
import { globalSupervisorQualifiedChatRef } from "../src/data/globalSupervisorBinding";

const SUPERVISOR = globalSupervisorQualifiedChatRef("home", "supervisor");
const SUPERVISOR_B = globalSupervisorQualifiedChatRef("other-home", "supervisor-b");
const WORKER_A = globalSupervisorQualifiedChatRef("server-a", "worker-a");
const WORKER_B = globalSupervisorQualifiedChatRef("server-b", "worker-b");

function completed(options: {
  readonly cursor: number;
  readonly observedAt: number;
  readonly status?: "completed" | "failed" | "interrupted";
  readonly summary?: string;
  readonly worker: string;
}) {
  const status = options.status ?? "completed";
  const turnId = `turn-${String(options.cursor)}`;
  return {
    cursor: options.cursor,
    payload: {
      codewideThreadPatch: {
        operation: {
          kind: "turnCompleted",
          summary: { previewText: options.summary ?? `Summary ${String(options.cursor)}` },
          turn: {
            completedAt: options.observedAt / 1000,
            id: turnId,
            status,
          },
        },
        threadId: options.worker,
        version: 1,
      },
      emittedAtMs: options.observedAt,
      method: "turn/completed",
      params: {
        threadId: options.worker,
        turn: { completedAt: options.observedAt / 1000, id: turnId, status },
      },
    },
  };
}

function owner(storage = createGlobalSupervisorAttentionStorage()) {
  return createGlobalSupervisorAttentionOwner({ now: () => 10_000, storage });
}

describe("Global Supervisor attention", () => {
  it("drops disabled-time attention and starts each activation from a fresh boundary", async () => {
    const attention = owner();
    await attention.follow(SUPERVISOR, WORKER_A);
    await attention.ingestEvents(WORKER_A.connectionId, [
      completed({ cursor: 1, observedAt: 11_000, worker: WORKER_A.threadId }),
    ]);

    await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(0);

    const enabling = attention.enableDelivery(SUPERVISOR);
    const afterEnable = attention.ingestEvents(WORKER_A.connectionId, [
      completed({ cursor: 2, observedAt: 12_000, worker: WORKER_A.threadId }),
    ]);
    await Promise.all([enabling, afterEnable]);

    await expect(attention.pending(SUPERVISOR)).resolves.toMatchObject([
      { sourceCursor: 2, worker: WORKER_A },
    ]);

    await attention.disableDelivery(SUPERVISOR);
    await attention.ingestEvents(WORKER_A.connectionId, [
      completed({ cursor: 3, observedAt: 13_000, worker: WORKER_A.threadId }),
    ]);
    await attention.enableDelivery(SUPERVISOR);

    await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(0);
  });

  it("keeps concurrent completions ordered, bounded, and idempotent", async () => {
    const attention = owner();
    await attention.enableDelivery(SUPERVISOR);
    await attention.follow(SUPERVISOR, WORKER_A);
    await attention.follow(SUPERVISOR, WORKER_B);
    const first = completed({
      cursor: 8,
      observedAt: 12_000,
      summary: "a".repeat(800),
      worker: WORKER_A.threadId,
    });
    const second = completed({
      cursor: 3,
      observedAt: 11_000,
      worker: WORKER_B.threadId,
    });

    await Promise.all([
      attention.ingestEvents(WORKER_A.connectionId, [first]),
      attention.ingestEvents(WORKER_B.connectionId, [second]),
    ]);
    await attention.ingestEvents(WORKER_A.connectionId, [first]);

    const pending = await attention.pending(SUPERVISOR);
    expect(pending).toHaveLength(2);
    expect(pending.map((event) => event.worker.threadId)).toEqual([
      WORKER_B.threadId,
      WORKER_A.threadId,
    ]);
    expect([...pending[1]!.summary]).toHaveLength(480);
    expect(pending[0]!.eventId).not.toBe(pending[1]!.eventId);
  });

  it("retains acknowledgement tombstones across restart and replay", async () => {
    const storage = createGlobalSupervisorAttentionStorage();
    const firstOwner = owner(storage);
    await firstOwner.enableDelivery(SUPERVISOR);
    await firstOwner.follow(SUPERVISOR, WORKER_A);
    const event = completed({ cursor: 4, observedAt: 12_000, worker: WORKER_A.threadId });
    await firstOwner.ingestEvents(WORKER_A.connectionId, [event]);
    const delivered = (await firstOwner.pending(SUPERVISOR))[0];
    if (delivered === undefined) {
      throw new Error("Missing attention fixture");
    }
    await firstOwner.acknowledge(SUPERVISOR, delivered.eventId);

    const restarted = owner(storage);
    await restarted.ingestEvents(WORKER_A.connectionId, [event]);

    await expect(restarted.pendingCount(SUPERVISOR)).resolves.toBe(0);
  });

  it("turns pending user interaction into content-free scoped attention", async () => {
    const attention = owner();
    await attention.enableDelivery(SUPERVISOR);
    await attention.follow(SUPERVISOR, WORKER_A);
    await attention.ingestPendingRequests(WORKER_A.connectionId, [
      {
        id: "approval-1",
        method: "item/commandExecution/requestApproval",
        params: { command: "secret command", threadId: WORKER_A.threadId },
      },
    ]);
    await attention.ingestPendingRequests("other-server", [
      {
        id: "approval-2",
        method: "item/commandExecution/requestApproval",
        params: { threadId: WORKER_A.threadId },
      },
    ]);

    const pending = await attention.pending(SUPERVISOR);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      kind: "needsInput",
      summary: "Worker chat is waiting for user approval.",
      worker: WORKER_A,
    });
    expect(JSON.stringify(pending)).not.toContain("secret command");

    await attention.ingestPendingRequests(WORKER_A.connectionId, []);
    await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(0);
  });

  it("reconciles persisted creation from thread events without polling", async () => {
    const attention = owner();
    await attention.enableDelivery(SUPERVISOR);
    const source = `${GLOBAL_SUPERVISOR_WORKER_SOURCE_PREFIX}creation`;
    await attention.beginWorkerCreation({
      source,
      supervisor: SUPERVISOR,
      workerConnectionId: WORKER_A.connectionId,
    });
    await attention.ingestEvents(WORKER_A.connectionId, [
      {
        cursor: 1,
        payload: {
          codewideThreadPatch: {
            operation: { kind: "threadStarted" },
            threadId: WORKER_A.threadId,
            version: 1,
          },
          method: "thread/started",
          params: {
            thread: { id: WORKER_A.threadId, threadSource: source },
            threadId: WORKER_A.threadId,
          },
        },
      },
      completed({ cursor: 2, observedAt: 12_000, worker: WORKER_A.threadId }),
    ]);

    await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(1);
  });

  it("keeps follow across runtime unload and removes it only when the worker is deleted", async () => {
    const attention = owner();
    await attention.enableDelivery(SUPERVISOR);
    await attention.enableDelivery(SUPERVISOR_B);
    await attention.follow(SUPERVISOR, WORKER_A);
    await attention.follow(SUPERVISOR_B, WORKER_A);
    await attention.ingestEvents(WORKER_A.connectionId, [
      completed({ cursor: 1, observedAt: 11_000, worker: WORKER_A.threadId }),
    ]);

    await attention.unfollow(SUPERVISOR, WORKER_A);
    await attention.ingestEvents(WORKER_A.connectionId, [
      completed({ cursor: 2, observedAt: 12_000, worker: WORKER_A.threadId }),
    ]);

    await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(0);
    await expect(attention.pendingCount(SUPERVISOR_B)).resolves.toBe(2);

    await attention.ingestEvents(WORKER_A.connectionId, [
      {
        cursor: 3,
        payload: {
          method: "thread/closed",
          params: { threadId: WORKER_A.threadId },
        },
      },
      completed({ cursor: 4, observedAt: 13_000, worker: WORKER_A.threadId }),
    ]);

    await expect(attention.pendingCount(SUPERVISOR_B)).resolves.toBe(3);

    await attention.ingestEvents(WORKER_A.connectionId, [
      {
        cursor: 5,
        payload: {
          method: "thread/deleted",
          params: { threadId: WORKER_A.threadId },
        },
      },
      completed({ cursor: 6, observedAt: 14_000, worker: WORKER_A.threadId }),
    ]);

    await expect(attention.pendingCount(SUPERVISOR_B)).resolves.toBe(3);
  });

  it("commits attention before the source batch can be acknowledged", async () => {
    const attention = owner();
    const gate = Promise.withResolvers<void>();
    vi.spyOn(attention, "ingestEvents").mockImplementationOnce(() => gate.promise);
    const base = {
      async applyEvents() {
        return { checkpoint: Promise.resolve(), threads: new Map() };
      },
      async applySnapshot() {},
    };
    const projection = createGlobalSupervisorAttentionProjection(base, attention);
    let settled = false;
    const applying = projection.applyEvents("server-a", []).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    gate.resolve();
    await applying;
    expect(settled).toBe(true);
  });

  it("queues voice delivery and acknowledges only after the resulting utterance", async () => {
    const attention = owner();
    await attention.enableDelivery(SUPERVISOR);
    await attention.follow(SUPERVISOR, WORKER_A);
    await attention.follow(SUPERVISOR, WORKER_B);
    await attention.ingestEvents(WORKER_A.connectionId, [
      completed({ cursor: 1, observedAt: 11_000, worker: WORKER_A.threadId }),
    ]);
    await attention.ingestEvents(WORKER_B.connectionId, [
      completed({ cursor: 2, observedAt: 12_000, worker: WORKER_B.threadId }),
    ]);
    const accepted = Promise.withResolvers<void>();
    const appendText = vi.fn(async () => {
      accepted.resolve();
    });
    const delivery = createGlobalSupervisorAttentionDeliverySession({
      appendText,
      attention,
      home: SUPERVISOR,
      onTerminal: vi.fn(),
    });

    expect(appendText).not.toHaveBeenCalled();
    delivery.setSpeechBusy(false);
    await accepted.promise;
    expect(appendText).toHaveBeenCalledOnce();
    await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(2);

    delivery.setSpeechBusy(false);
    await vi.waitFor(async () => {
      await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(1);
    });
    expect(appendText).toHaveBeenCalledTimes(2);

    delivery.setSpeechBusy(false);
    await vi.waitFor(async () => {
      await expect(attention.pendingCount(SUPERVISOR)).resolves.toBe(0);
    });
    await delivery.stop();
  });

  it("waits for a subscription signal instead of polling an empty attention queue", async () => {
    const attention = owner();
    const pending = vi.spyOn(attention, "pending");
    const appendText = vi.fn(async () => undefined);
    const delivery = createGlobalSupervisorAttentionDeliverySession({
      appendText,
      attention,
      home: SUPERVISOR,
      onTerminal: vi.fn(),
    });

    delivery.setSpeechBusy(false);
    await vi.waitFor(() => expect(pending).toHaveBeenCalledOnce());
    await Promise.resolve();
    await Promise.resolve();

    expect(pending).toHaveBeenCalledOnce();
    expect(appendText).not.toHaveBeenCalled();
    await delivery.stop();
  });
});
