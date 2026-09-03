import { describe, expect, it, jest } from "@jest/globals";
import type {
  V2Command,
  V2CommandResult,
  V2CommandTerminalFrame,
  V2ThreadSummary,
} from "@codewide/sync-client/v2";

import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import {
  createTurnActions,
  turnActionAvailability,
} from "../src/v2/features/turnActions/turnActions";
import type {
  TurnActionCommandPort,
  TurnActionPresentationPort,
} from "../src/v2/features/turnActions/turnActionTypes";

const owner = qualifiedThread(savedServerId("saved-server-a"), threadId("thread-a"));

describe("V2 turn actions", () => {
  it("interrupts only the requested authoritative turn", async () => {
    const execute = jest.fn<TurnActionCommandPort["execute"]>(async () =>
      completed({
        kind: "turn.interrupt",
        state: "interrupted",
        threadId: "thread-a",
        turnId: "turn-a",
      }),
    );
    const actions = createTurnActions({
      commands: { execute },
      owner,
      presentation: presentation(),
    });

    await expect(actions.interruptTurn("turn-a")).resolves.toMatchObject({ state: "interrupted" });
    expect(execute).toHaveBeenCalledWith(owner.savedServerId, {
      kind: "turn.interrupt",
      threadId: owner.threadId,
      turnId: "turn-a",
    });
  });

  it("rejects a mismatched interrupt response", async () => {
    const execute = jest.fn<TurnActionCommandPort["execute"]>(async () =>
      completed({
        kind: "turn.interrupt",
        state: "interrupted",
        threadId: "thread-a",
        turnId: "turn-b",
      }),
    );
    const actions = createTurnActions({
      commands: { execute },
      owner,
      presentation: presentation(),
    });

    await expect(actions.interruptTurn("turn-a")).rejects.toThrow("mismatched interrupt");
  });

  it("forks through the selected completed turn", async () => {
    const forked = threadSummary("fork-a");
    const execute = jest.fn<TurnActionCommandPort["execute"]>(async () =>
      completed({ kind: "thread.fork", thread: forked }),
    );
    const actions = createTurnActions({
      commands: { execute },
      owner,
      presentation: presentation(),
    });

    await expect(actions.forkThroughTurn("turn-a")).resolves.toEqual({
      kind: "thread.fork",
      thread: forked,
    });
    expect(execute).toHaveBeenCalledWith(owner.savedServerId, {
      kind: "thread.fork",
      threadId: owner.threadId,
      throughTurnId: "turn-a",
    });
  });

  it("opens the editor only after an authoritative rollback completion", async () => {
    let settle: ((frame: V2CommandTerminalFrame) => void) | null = null;
    const execute = jest.fn<TurnActionCommandPort["execute"]>(
      () => new Promise((resolve) => (settle = resolve)),
    );
    const view = presentation();
    const actions = createTurnActions({ commands: { execute }, owner, presentation: view });
    const editing = actions.editPriorTurn({
      draftInput: [{ kind: "text", text: "original prompt" }],
      rollbackThroughTurnId: "turn-before",
      sourceTurnId: "turn-edited",
    });

    expect(view.openPriorTurnEditor).not.toHaveBeenCalled();
    if (settle === null) throw new Error("Rollback command was not started");
    settle(
      completed({
        headTurnId: "turn-before",
        kind: "thread.rollback",
        thread: threadSummary("thread-a"),
      }),
    );
    await editing;

    expect(execute).toHaveBeenCalledWith(owner.savedServerId, {
      dropFollowingTurns: true,
      kind: "thread.rollback",
      threadId: owner.threadId,
      throughTurnId: "turn-before",
    });
    expect(view.openPriorTurnEditor).toHaveBeenCalledWith({
      draftInput: [{ kind: "text", text: "original prompt" }],
      sourceTurnId: "turn-edited",
    });
  });

  it("does not open the editor when rollback fails", async () => {
    const execute = jest.fn<TurnActionCommandPort["execute"]>(async () =>
      failed("Rollback failed"),
    );
    const view = presentation();
    const actions = createTurnActions({ commands: { execute }, owner, presentation: view });

    await expect(
      actions.editPriorTurn({
        draftInput: [{ kind: "text", text: "original prompt" }],
        rollbackThroughTurnId: "turn-before",
        sourceTurnId: "turn-edited",
      }),
    ).rejects.toThrow("Rollback failed");
    expect(view.openPriorTurnEditor).not.toHaveBeenCalled();
  });

  it("delegates response review without creating a server command", async () => {
    const execute = jest.fn<TurnActionCommandPort["execute"]>();
    const view = presentation();
    const actions = createTurnActions({ commands: { execute }, owner, presentation: view });

    await actions.reviewResponse({ itemId: "assistant-item-a", turnId: "turn-a" });

    expect(execute).not.toHaveBeenCalled();
    expect(view.openResponseReview).toHaveBeenCalledWith({
      itemId: "assistant-item-a",
      owner,
      turnId: "turn-a",
    });
  });

  it("derives availability from authoritative turn state", () => {
    expect(
      turnActionAvailability({
        hasAssistantResponse: true,
        hasRollbackBoundary: true,
        state: "running",
      }),
    ).toEqual({ canFork: false, canInterrupt: true, canReview: false, canRollback: false });
    expect(
      turnActionAvailability({
        hasAssistantResponse: true,
        hasRollbackBoundary: true,
        state: "completed",
      }),
    ).toEqual({ canFork: true, canInterrupt: false, canReview: true, canRollback: true });
  });
});

function presentation(): TurnActionPresentationPort {
  return {
    openPriorTurnEditor: jest.fn(),
    openResponseReview: jest.fn(),
  };
}

function completed(result: V2CommandResult): V2CommandTerminalFrame {
  return { operationId: "operation-a", result, type: "commandCompleted" };
}

function failed(message: string): V2CommandTerminalFrame {
  return {
    error: { code: "conflict", message, recovery: "requery" },
    operationId: "operation-a",
    type: "commandFailed",
  };
}

function threadSummary(id: string): V2ThreadSummary {
  return {
    archived: false,
    createdAt: "2026-09-03T00:00:00Z",
    headTurnId: null,
    id,
    lastActivityAt: null,
    parentId: null,
    preview: "",
    settings: null,
    state: "idle",
    title: "Thread",
    updatedAt: "2026-09-03T00:00:00Z",
    workspace: "/workspace",
  };
}
