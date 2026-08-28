import { describe, expect, it } from "vitest";

import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  V2_OPERATION_RECEIPT_MAX_AGE_MS,
  type V2Command,
} from "../src/index.js";
import { makeLive, savedServerA, savedServerB, setup, snapshot, waitFor } from "./v2-fixtures.js";

describe("Sync V2 durable operations", () => {
  it("uses canonical command identity instead of property insertion order", async () => {
    const store = new MemoryV2OperationStore();
    const left = { kind: "turn.interrupt", threadId: "thread", turnId: "turn" } as const;
    const right = { turnId: "turn", kind: "turn.interrupt", threadId: "thread" } as const;
    const created = await store.create(savedServerA, "operation", left, 0);
    const replay = await store.create(savedServerA, "operation", right, 0);
    expect(replay.commandFingerprint).toBe(created.commandFingerprint);
    await expect(store.create(savedServerA, "operation", { ...left, turnId: "other" }, 0)).rejects.toThrow("different canonical command");
  });

  it("serializes immediate accepted-to-terminal delivery", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("operation-1", { kind: "thread.delete", threadId: "thread-1" });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({ type: "commandAccepted", requestId, operationId: "operation-1", acceptedAt: "2026-08-27T12:00:00Z" });
    socket.emit({ type: "commandCompleted", operationId: "operation-1", result: { kind: "thread.delete", threadId: "thread-1" } });
    await expect(terminal).resolves.toEqual(expect.objectContaining({ type: "commandCompleted" }));
    expect((await operations.get(savedServerA, "operation-1"))?.state).toBe("completed");
    session.stop();
  });

  it.each([
    ["commandRejected", false, "rejected", { code: "invalidRequest", recovery: "none", message: "invalid" }],
    ["commandExpired", false, "expired", { code: "operationExpired", recovery: "userAction", message: "expired" }],
    ["commandFailed", true, "failed", { code: "sourceUnavailable", recovery: "retry", message: "failed" }],
    ["commandIndeterminate", true, "indeterminate", { code: "operationIndeterminate", recovery: "requery", message: "unknown" }],
  ] as const)("persists %s as an exhaustive terminal state", async (type, accepted, state, error) => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command(`operation-${state}`, { kind: "thread.delete", threadId: "thread-1" });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    if (accepted) socket.emit({ type: "commandAccepted", requestId, operationId: `operation-${state}`, acceptedAt: "2026-08-27T12:00:00Z" });
    socket.emit({ type, ...(accepted ? {} : { requestId }), operationId: `operation-${state}`, error });
    await expect(terminal).resolves.toEqual(expect.objectContaining({ type }));
    const persisted = await operations.get(savedServerA, `operation-${state}`);
    expect(persisted?.state).toBe(state);
    expect(persisted?.command).toBeNull();
    expect(persisted).not.toHaveProperty("error");
    expect(persisted).not.toHaveProperty("result");
    session.stop();
  });

  it("recovers only unconfirmed sent operations after response loss and restart", async () => {
    const operations = new MemoryV2OperationStore();
    const first = setup(undefined, operations);
    await makeLive(first.socket, first.session);
    void first.session.command("lost-response", { kind: "thread.delete", threadId: "thread-1" }).catch(() => undefined);
    await waitFor(() => first.socket.sent.some((frame) => frame.type === "command"));
    first.socket.close(1006, "lost");
    expect((await operations.get(savedServerA, "lost-response"))?.state).toBe("sent");

    const second = setup(undefined, operations);
    await makeLive(second.socket, second.session, snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" }));
    await waitFor(() => second.socket.sent.some((frame) => frame.type === "command"));
    const requestId = second.socket.sent.find((frame) => frame.type === "command")?.requestId;
    second.socket.emit({ type: "commandAccepted", requestId, operationId: "lost-response", acceptedAt: "2026-08-27T12:00:00Z" });
    second.socket.emit({ type: "commandCompleted", operationId: "lost-response", result: { kind: "thread.delete", threadId: "thread-1" } });
    await waitFor(async () => (await operations.get(savedServerA, "lost-response"))?.state === "completed");
    second.session.stop();
  });

  it("never resends an acceptance recorded before disconnect", async () => {
    const operations = new MemoryV2OperationStore();
    const first = setup(undefined, operations);
    await makeLive(first.socket, first.session);
    void first.session.command("accepted", { kind: "thread.delete", threadId: "thread-1" }).catch(() => undefined);
    await waitFor(() => first.socket.sent.some((frame) => frame.type === "command"));
    const requestId = first.socket.sent.find((frame) => frame.type === "command")?.requestId;
    first.socket.emit({ type: "commandAccepted", requestId, operationId: "accepted", acceptedAt: "2026-08-27T12:00:00Z" });
    await waitFor(async () => (await operations.get(savedServerA, "accepted"))?.state === "accepted");
    first.socket.close(1006, "lost");

    const second = setup(undefined, operations);
    await makeLive(second.socket, second.session, snapshot({ epochId: "epoch-2", revision: "sync-v2-revision:2" }));
    await Promise.resolve();
    expect(second.socket.sent.some((frame) => frame.type === "command")).toBe(false);
    second.session.stop();
  });

  it("rejects a post-admission terminal frame before acceptance", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    void session.command("terminal-before-acceptance", { kind: "thread.delete", threadId: "thread-1" }).catch(() => undefined);
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    socket.emit({ type: "commandCompleted", operationId: "terminal-before-acceptance", result: { kind: "thread.delete", threadId: "thread-1" } });
    await waitFor(() => socket.closes.at(-1)?.reason === "command_terminal_out_of_phase");
    expect(socket.closes.at(-1)?.code).toBe(1008);
    expect((await operations.get(savedServerA, "terminal-before-acceptance"))?.state).toBe("sent");
    session.stop();
  });

  it("rejects acceptance after a pre-admission terminal state", async () => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("acceptance-after-terminal", { kind: "thread.delete", threadId: "thread-1" });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({ type: "commandRejected", requestId, operationId: "acceptance-after-terminal", error: { code: "invalidRequest", recovery: "none", message: "rejected" } });
    await expect(terminal).resolves.toMatchObject({ type: "commandRejected" });
    socket.emit({ type: "commandAccepted", requestId, operationId: "acceptance-after-terminal", acceptedAt: "2026-08-27T12:00:00Z" });
    await waitFor(() => socket.closes.at(-1)?.reason === "command_acceptance_out_of_phase");
    expect((await operations.get(savedServerA, "acceptance-after-terminal"))?.state).toBe("rejected");
    session.stop();
  });

  it.each([
    ["duplicate", { type: "commandCompleted", operationId: "duplicate-terminal", result: { kind: "thread.delete", threadId: "thread-1" } }],
    ["conflicting", { type: "commandFailed", operationId: "duplicate-terminal", error: { code: "sourceUnavailable", recovery: "retry", message: "failed" } }],
  ] as const)("rejects a %s terminal frame after the operation is terminal", async (_kind, secondTerminal) => {
    const operations = new MemoryV2OperationStore();
    const { socket, session } = setup(undefined, operations);
    await makeLive(socket, session);
    const terminal = session.command("duplicate-terminal", { kind: "thread.delete", threadId: "thread-1" });
    await waitFor(() => socket.sent.some((frame) => frame.type === "command"));
    const requestId = socket.sent.find((frame) => frame.type === "command")?.requestId;
    socket.emit({ type: "commandAccepted", requestId, operationId: "duplicate-terminal", acceptedAt: "2026-08-27T12:00:00Z" });
    socket.emit({ type: "commandCompleted", operationId: "duplicate-terminal", result: { kind: "thread.delete", threadId: "thread-1" } });
    await expect(terminal).resolves.toMatchObject({ type: "commandCompleted" });
    socket.emit(secondTerminal);
    await waitFor(() => socket.closes.at(-1)?.reason === "command_terminal_out_of_phase");
    expect((await operations.get(savedServerA, "duplicate-terminal"))?.state).toBe("completed");
    session.stop();
  });

  it("deletes content-free receipt metadata after the 30-day maximum", async () => {
    const store = new MemoryV2OperationStore();
    await store.create(savedServerA, "operation", { kind: "thread.delete", threadId: "thread-1" }, 0);
    await store.transition(savedServerA, "operation", ["created"], { state: "sent" }, 0);
    await store.transition(savedServerA, "operation", ["sent"], { state: "accepted", acceptedAt: "1970-01-01T00:00:00Z" }, 0);
    await store.transition(savedServerA, "operation", ["accepted"], { state: "failed" }, 0);
    await store.prune(savedServerA, V2_OPERATION_RECEIPT_MAX_AGE_MS + 1);
    expect(await store.get(savedServerA, "operation")).toBeNull();
  });

  it("purges exactly one saved-server partition on explicit deletion", async () => {
    const projections = new MemoryV2ProjectionStore();
    const operations = new MemoryV2OperationStore();
    await projections.commitSnapshot(savedServerA, snapshot());
    await projections.commitSnapshot(savedServerB, snapshot({ epochId: "epoch-b", revision: "sync-v2-revision:b" }));
    const command: V2Command = { kind: "thread.delete", threadId: "thread-a" };
    await operations.create(savedServerA, "same-id", command);
    await operations.create(savedServerB, "same-id", { ...command, threadId: "thread-b" });
    await Promise.all([projections.deleteSavedServer(savedServerA), operations.deleteSavedServer(savedServerA)]);
    expect(await projections.active(savedServerA)).toBeNull();
    expect(await operations.get(savedServerA, "same-id")).toBeNull();
    expect(await projections.active(savedServerB)).not.toBeNull();
    expect((await operations.get(savedServerB, "same-id"))?.command).toEqual(expect.objectContaining({ threadId: "thread-b" }));
  });
});
