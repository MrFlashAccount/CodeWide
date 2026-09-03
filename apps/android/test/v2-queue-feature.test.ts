import { describe, expect, it, vi } from "vitest";
import type {
  V2Command,
  V2CommandTerminalFrame,
  V2QueueItem,
  V2QueueMutationOutcome,
} from "@codewide/sync-client/v2";

import { deliveryCommand } from "../src/v2/features/queue/deliveryCommand";
import { QueueActions } from "../src/v2/features/queue/queueActions";
import { queueMoveTarget, queueRows } from "../src/v2/features/queue/queueModel";

describe("V2 queue feature", () => {
  it("projects only actionable authoritative queue rows in u64 position order", () => {
    expect(queueRows([item("done", "9", "done"), item("late", "10"), item("early", "2")])).toEqual([
      {
        attachmentCount: 0,
        attachments: [],
        editableText: "early prompt",
        error: null,
        id: "early",
        state: "queued",
        summary: "early prompt",
      },
      {
        attachmentCount: 0,
        attachments: [],
        editableText: "late prompt",
        error: null,
        id: "late",
        state: "queued",
        summary: "late prompt",
      },
    ]);
  });

  it("projects exact authoritative attachment names without guessing from ids", () => {
    const queued = item("attachment", "1");
    queued.input.push({ attachmentId: "opaque-id", kind: "attachment" });
    queued.attachments.push({ id: "opaque-id", name: "Release notes final.md" });

    expect(queueRows([queued])[0]?.attachments).toEqual([
      { id: "opaque-id", name: "Release notes final.md" },
    ]);
  });

  it("rejects queue attachments whose authoritative display metadata is missing", () => {
    const queued = item("attachment", "1");
    queued.input.push({ attachmentId: "opaque-id", kind: "attachment" });

    expect(() => queueRows([queued])).toThrow("Queue attachment display metadata is missing");
  });

  it("computes exact move-before targets without rewriting the queue locally", () => {
    const items = [item("a", "1"), item("b", "2"), item("c", "3")];
    expect(queueMoveTarget(items, "b", -1)).toEqual({ beforeItemId: "a" });
    expect(queueMoveTarget(items, "b", 1)).toEqual({ beforeItemId: null });
    expect(queueMoveTarget(items, "a", 1)).toEqual({ beforeItemId: "c" });
    expect(queueMoveTarget(items, "a", 20)).toEqual({ beforeItemId: null });
    expect(queueMoveTarget(items, "c", -20)).toEqual({ beforeItemId: "a" });
    expect(queueMoveTarget(items, "a", -1)).toBeNull();
    expect(queueMoveTarget(items, "a", Number.NaN)).toBeNull();
  });

  it("reorders only queued records because running and failed rows are not placement targets", () => {
    const items = [item("a", "1"), item("running", "2", "running"), item("b", "3")];
    expect(queueMoveTarget(items, "a", 1)).toEqual({ beforeItemId: null });
    expect(queueMoveTarget(items, "running", 1)).toBeNull();
  });

  it("maps one composer activation to send, queue, or steer protocol commands", () => {
    const submit = submitCommand();
    expect(
      deliveryCommand({ activeTurnId: null, mode: "sendNow", submit, threadRunning: false }),
    ).toBe(submit);
    expect(
      deliveryCommand({ activeTurnId: "turn", mode: "queue", submit, threadRunning: true }),
    ).toEqual({
      kind: "queue.mutate",
      mutation: { input: submit.input, kind: "put", threadId: "thread" },
    });
    expect(
      deliveryCommand({ activeTurnId: "turn", mode: "steer", submit, threadRunning: true }),
    ).toEqual({
      input: submit.input,
      kind: "turn.steer",
      threadId: "thread",
      turnId: "turn",
    });
  });

  it("rejects a delivery mode that became stale before composer activation", () => {
    const submit = submitCommand();
    expect(() =>
      deliveryCommand({ activeTurnId: "turn", mode: "sendNow", submit, threadRunning: true }),
    ).toThrow("Send now is unavailable while this thread is running");
    expect(() =>
      deliveryCommand({ activeTurnId: null, mode: "queue", submit, threadRunning: false }),
    ).toThrow("Queue requires a running thread");
  });

  it("awaits the authoritative refresh after each queue mutation", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const refresh = vi.fn(async () => undefined);
    const failed = item("failed", "2", "failed");
    const actions = actionsFor({ execute, items: [item("a", "1"), failed], refresh });

    await actions.onEdit("a", " revised ");
    await actions.onRetry("failed");
    await actions.onCancel("a");

    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      {
        kind: "queue.mutate",
        mutation: {
          editableInput: [{ kind: "text", text: "revised" }],
          expectedRevision: "revision-1",
          itemId: "a",
          kind: "edit",
        },
      },
      {
        kind: "queue.mutate",
        mutation: { expectedRevision: "revision-1", itemId: "failed", kind: "retry" },
      },
      {
        kind: "queue.mutate",
        mutation: { expectedRevision: "revision-1", itemId: "a", kind: "cancel" },
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("moves a dragged row once with the authoritative queue revision and exact target", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const refresh = vi.fn(async () => undefined);
    const items = [item("a", "1"), item("b", "2"), item("c", "3"), item("d", "4")];
    const actions = actionsFor({ execute, items, refresh });

    await actions.onMove("a", 2);

    expect(execute).toHaveBeenCalledWith({
      kind: "queue.mutate",
      mutation: {
        beforeItemId: "d",
        expectedRevision: "revision-1",
        itemId: "a",
        kind: "move",
      },
    });
    expect(items.map(({ id }) => id)).toEqual(["a", "b", "c", "d"]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refreshes a CAS conflict and retries from the new authoritative revision", async () => {
    let revision = "revision-1";
    const execute = vi
      .fn<(command: V2Command) => Promise<V2CommandTerminalFrame>>()
      .mockResolvedValueOnce(commandFailed("conflict", "queue revision changed"))
      .mockImplementation(async (command) => completed(command));
    const refresh = vi.fn(async () => {
      revision = "revision-2";
    });
    const actions = actionsFor({
      execute,
      items: [item("a", "1"), item("b", "2")],
      refresh,
      revision: () => revision,
    });

    await expect(actions.onMove("b", -1)).rejects.toThrow(
      "The queue changed on the server. Review the refreshed order and try again",
    );
    await actions.onMove("b", -1);

    expect(execute.mock.calls.map(([command]) => command)).toEqual([
      {
        kind: "queue.mutate",
        mutation: {
          beforeItemId: "a",
          expectedRevision: "revision-1",
          itemId: "b",
          kind: "move",
        },
      },
      {
        kind: "queue.mutate",
        mutation: {
          beforeItemId: "a",
          expectedRevision: "revision-2",
          itemId: "b",
          kind: "move",
        },
      },
    ]);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("surfaces a definite reorder failure without refreshing an unchanged projection", async () => {
    const execute = vi.fn(async () => commandFailed("forbidden", "queue mutation denied"));
    const refresh = vi.fn(async () => undefined);
    const actions = actionsFor({
      execute,
      items: [item("a", "1"), item("b", "2")],
      refresh,
    });

    await expect(actions.onMove("a", 1)).rejects.toThrow("queue mutation denied");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not retry or delete an uncertain delivery result", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const actions = actionsFor({
      execute,
      items: [item("uncertain", "1", "uncertain")],
      refresh: vi.fn(async () => undefined),
    });

    await expect(actions.onRetry("uncertain")).rejects.toThrow(
      "Only a failed queued prompt can be retried",
    );
    await expect(actions.onCancel("uncertain")).rejects.toThrow(
      "This queue item cannot be deleted while delivery is unresolved",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("surfaces indeterminate mutations without claiming a refreshed projection", async () => {
    const execute = vi.fn(async () => indeterminate());
    const refresh = vi.fn(async () => undefined);
    const actions = actionsFor({ execute, refresh });

    await expect(actions.onCancel("a")).rejects.toThrow(
      "The server could not determine whether this queue action completed",
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("edits only mutable blocks while retaining every authoritative attachment", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const queuedItem = item("a", "1");
    queuedItem.input = [
      { kind: "text", text: "old text" },
      { attachmentId: "attachment", kind: "attachment" },
      { kind: "skill", name: "review", path: "/skills/review" },
    ];
    const actions = actionsFor({
      execute,
      items: [queuedItem],
      refresh: vi.fn(async () => undefined),
    });

    await actions.onEdit("a", "new text");

    expect(execute).toHaveBeenCalledWith({
      kind: "queue.mutate",
      mutation: {
        editableInput: [
          { kind: "text", text: "new text" },
          { attachmentId: "attachment", kind: "attachment" },
        ],
        expectedRevision: "revision-1",
        itemId: "a",
        kind: "edit",
      },
    });

    await actions.onEdit("a", "");
    expect(execute).toHaveBeenLastCalledWith({
      kind: "queue.mutate",
      mutation: {
        editableInput: [{ attachmentId: "attachment", kind: "attachment" }],
        expectedRevision: "revision-1",
        itemId: "a",
        kind: "edit",
      },
    });
  });

  it("replaces the authoritative attachment set with explicitly staged queue edits", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const queuedItem = item("a", "1");
    queuedItem.input = [
      { kind: "text", text: "old" },
      { attachmentId: "old-attachment", kind: "attachment" },
    ];
    const actions = actionsFor({
      execute,
      items: [queuedItem],
      refresh: vi.fn(async () => undefined),
    });

    await actions.onEdit("a", "new", ["retained", "newly-staged"]);

    expect(execute).toHaveBeenCalledWith({
      kind: "queue.mutate",
      mutation: {
        editableInput: [
          { kind: "text", text: "new" },
          { attachmentId: "retained", kind: "attachment" },
          { attachmentId: "newly-staged", kind: "attachment" },
        ],
        expectedRevision: "revision-1",
        itemId: "a",
        kind: "edit",
      },
    });
  });

  it("atomically steers the authoritative queued item by identity", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const refresh = vi.fn(async () => undefined);
    const queuedItem = item("a", "1");
    queuedItem.input = [
      { kind: "text", text: "a prompt" },
      { attachmentId: "attachment", kind: "attachment" },
      { kind: "skill", name: "review", path: "/skills/review" },
    ];
    const actions = actionsFor({ execute, items: [queuedItem], refresh });

    await actions.onSteer("a");

    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      {
        kind: "queue.mutate",
        mutation: {
          expectedRevision: "revision-1",
          itemId: "a",
          kind: "steer",
          turnId: "turn",
        },
      },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("rejects mutations while the visible queue is retained from an old authority", async () => {
    const execute = vi.fn(async (command: V2Command) => completed(command));
    const refresh = vi.fn(async () => undefined);
    const actions = actionsFor({ actionable: false, execute, refresh });

    await expect(actions.onEdit("a", "new text")).rejects.toThrow(
      "Wait for the current queue before changing queued prompts",
    );
    await expect(actions.onCancel("a")).rejects.toThrow(
      "Wait for the current queue before changing queued prompts",
    );
    await expect(actions.onMove("a", -1)).rejects.toThrow(
      "Wait for the current queue before changing queued prompts",
    );
    await expect(actions.onRetry("a")).rejects.toThrow(
      "Wait for the current queue before changing queued prompts",
    );
    await expect(actions.onSteer("a")).rejects.toThrow(
      "Wait for the current queue before changing queued prompts",
    );
    expect(execute).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});

interface ActionOverrides {
  actionable?: boolean;
  execute(command: V2Command): Promise<V2CommandTerminalFrame>;
  items?: V2QueueItem[];
  refresh(): Promise<void>;
  revision?: string | (() => string);
}

function actionsFor(overrides: ActionOverrides): QueueActions {
  return new QueueActions({
    actionable: () => overrides.actionable ?? true,
    activeTurnId: () => "turn",
    execute: overrides.execute,
    items: () => overrides.items ?? [item("a", "1")],
    refresh: overrides.refresh,
    revision: () =>
      typeof overrides.revision === "function"
        ? overrides.revision()
        : (overrides.revision ?? "revision-1"),
  });
}

function item(id: string, position: string, state: V2QueueItem["state"] = "queued"): V2QueueItem {
  return {
    attachments: [],
    id,
    input: [{ kind: "text", text: `${id} prompt` }],
    lastError: null,
    position,
    state,
    summary: `${id} prompt`,
    threadId: "thread",
  };
}

function submitCommand(): Extract<V2Command, { kind: "turn.submit" }> {
  return {
    input: [{ kind: "text", text: "hello" }],
    intent: "chat",
    kind: "turn.submit",
    settings: null,
    threadId: "thread",
    workspace: null,
  };
}

function completed(command: V2Command): V2CommandTerminalFrame {
  if (command.kind === "turn.steer") {
    return {
      operationId: "operation",
      result: {
        itemId: "steer",
        kind: "turn.steer",
        threadId: command.threadId,
        turnId: command.turnId,
      },
      type: "commandCompleted",
    };
  }
  return {
    operationId: "operation",
    result: { kind: "queue.mutate", outcome: queueMutationOutcome(command) },
    type: "commandCompleted",
  };
}

function queueMutationOutcome(command: V2Command): V2QueueMutationOutcome {
  if (command.kind === "queue.mutate" && command.mutation.kind === "cancel") {
    return { itemId: command.mutation.itemId, kind: "cancelled" };
  }
  if (command.kind === "queue.mutate" && command.mutation.kind === "steer") {
    return {
      itemId: command.mutation.itemId,
      kind: "steered",
      threadId: "thread",
      turnId: command.mutation.turnId,
    };
  }
  return { item: item("result", "1"), kind: "item" };
}

function indeterminate(): V2CommandTerminalFrame {
  return {
    error: { code: "indeterminateDelivery", message: "delivery outcome is unknown" },
    operationId: "operation",
    type: "commandIndeterminate",
  };
}

function commandFailed(code: "conflict" | "forbidden", message: string): V2CommandTerminalFrame {
  return {
    error: {
      code,
      message,
      recovery: code === "conflict" ? "requery" : "userAction",
    },
    operationId: "operation",
    type: "commandFailed",
  };
}
