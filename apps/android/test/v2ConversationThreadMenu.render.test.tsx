import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type {
  V2CommandResult,
  V2CommandTerminalFrame,
  V2ThreadSummary,
} from "@codewide/sync-client/v2";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import { ConversationThreadMenu } from "../src/v2/features/conversation/ConversationThreadMenu";
import {
  serverDestination,
  threadDestination,
} from "../src/v2/features/navigation/routeDestinations";
import { invokeAppDialogAction, resetAppDialog } from "./mocks/AppDialog";

const SERVER_ID = savedServerId("server-a");
const OWNER = qualifiedThread(SERVER_ID, threadId("thread-a"));

beforeEach(resetAppDialog);
afterEach(() => jest.restoreAllMocks());

describe("V2 conversation thread menu routing", () => {
  it("keeps fork pending and replaces the route with the returned thread", async () => {
    let settle: ((frame: V2CommandTerminalFrame) => void) | null = null;
    const execute = jest.fn(
      () =>
        new Promise<V2CommandTerminalFrame>((resolve) => {
          settle = resolve;
        }),
    );
    const replace = jest.spyOn(router, "replace").mockImplementation(() => undefined);
    renderMenu(execute, jest.fn());

    fireEvent.press(screen.getByLabelText("Thread menu"));
    await act(async () => fireEvent.press(screen.getByLabelText("Thread menu: Fork thread")));

    expect(execute).toHaveBeenCalledWith(SERVER_ID, {
      kind: "thread.fork",
      threadId: OWNER.threadId,
      throughTurnId: null,
    });
    expect(replace).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("Thread menu: Fork thread"));
    expect(execute).toHaveBeenCalledTimes(1);
    if (settle === null) {
      throw new Error("Fork command did not start");
    }

    await act(async () => settle(completed("thread.fork", threadSummary("fork-a"))));

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(
        threadDestination(qualifiedThread(SERVER_ID, threadId("fork-a"))),
      ),
    );
  });

  it("reports archive failure and exits to the owning thread list only after success", async () => {
    const execute = jest
      .fn<() => Promise<V2CommandTerminalFrame>>()
      .mockResolvedValueOnce(failed("Archive was rejected"))
      .mockResolvedValueOnce(completed("thread.update", threadSummary("thread-a")));
    const onError = jest.fn();
    const replace = jest.spyOn(router, "replace").mockImplementation(() => undefined);
    renderMenu(execute, onError);

    fireEvent.press(screen.getByLabelText("Thread menu"));
    await act(async () => fireEvent.press(screen.getByLabelText("Thread menu: Archive thread")));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Archive was rejected"));
    expect(replace).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(screen.getByLabelText("Thread menu: Archive thread")));
    await waitFor(() => expect(replace).toHaveBeenCalledWith(serverDestination(SERVER_ID)));
  });

  it("keeps compact on the shared pending path and preserves the exact server error", async () => {
    let settle: ((frame: V2CommandTerminalFrame) => void) | null = null;
    const execute = jest.fn(
      () =>
        new Promise<V2CommandTerminalFrame>((resolve) => {
          settle = resolve;
        }),
    );
    const onError = jest.fn();
    renderMenu(execute, onError);

    fireEvent.press(screen.getByLabelText("Thread menu"));
    await act(async () => fireEvent.press(screen.getByLabelText("Thread menu: Compact context")));
    fireEvent.press(screen.getByLabelText("Thread menu: Compact context"));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(SERVER_ID, {
      kind: "thread.compact",
      threadId: OWNER.threadId,
    });
    if (settle === null) {
      throw new Error("Compact command did not start");
    }

    await act(async () => settle(failed("Compaction rejected by policy")));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Compaction rejected by policy"));
  });

  it("confirms delete once, blocks duplicate activation, and leaves only after typed success", async () => {
    let settle: ((frame: V2CommandTerminalFrame) => void) | null = null;
    const execute = jest.fn(
      () =>
        new Promise<V2CommandTerminalFrame>((resolve) => {
          settle = resolve;
        }),
    );
    const onBack = jest.fn();
    const onError = jest.fn();
    renderMenu(execute, onError, onBack);

    fireEvent.press(screen.getByLabelText("Thread menu"));
    fireEvent.press(screen.getByLabelText("Thread menu: Delete thread"));
    await act(async () => {
      invokeAppDialogAction("Delete");
      invokeAppDialogAction("Delete");
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(SERVER_ID, {
      kind: "thread.delete",
      threadId: OWNER.threadId,
    });
    expect(onBack).not.toHaveBeenCalled();
    if (settle === null) {
      throw new Error("Delete command did not start");
    }

    await act(async () =>
      settle(
        completedResult({
          kind: "thread.delete",
          threadId: OWNER.threadId,
        }),
      ),
    );

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("preserves a delete failure and permits an explicit retry", async () => {
    const execute = jest
      .fn<() => Promise<V2CommandTerminalFrame>>()
      .mockResolvedValueOnce(failed("Deletion rejected by server"))
      .mockResolvedValueOnce(completedResult({ kind: "thread.delete", threadId: OWNER.threadId }));
    const onBack = jest.fn();
    const onError = jest.fn();
    renderMenu(execute, onError, onBack);

    fireEvent.press(screen.getByLabelText("Thread menu"));
    fireEvent.press(screen.getByLabelText("Thread menu: Delete thread"));
    await act(async () => invokeAppDialogAction("Delete"));

    await waitFor(() => expect(onError).toHaveBeenCalledWith("Deletion rejected by server"));
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Thread menu: Delete thread"));
    await act(async () => invokeAppDialogAction("Delete"));

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

function renderMenu(
  execute: (savedServerId: string, command: unknown) => Promise<V2CommandTerminalFrame>,
  onError: (message: string) => void,
  onBack: () => void = () => undefined,
): void {
  const pinsSnapshot = { status: "ready" as const, value: new Map() };
  const pins = {
    setPinned: async () => undefined,
    snapshot: () => pinsSnapshot,
    subscribe: () => () => undefined,
  };
  const runtime = {
    commandActivations: { execute },
    threadPins: pins,
  } as unknown as V2Runtime;
  render(
    <V2RuntimeProvider runtime={runtime}>
      <ConversationThreadMenu
        archived={false}
        live
        onBack={onBack}
        onError={onError}
        owner={OWNER}
        title="Thread A"
      />
    </V2RuntimeProvider>,
  );
}

function completed(
  kind: "thread.fork" | "thread.update",
  thread: V2ThreadSummary,
): V2CommandTerminalFrame {
  return { operationId: "operation-a", result: { kind, thread }, type: "commandCompleted" };
}

function failed(message: string): V2CommandTerminalFrame {
  return {
    error: { code: "conflict", message, recovery: "requery" },
    operationId: "operation-a",
    type: "commandFailed",
  };
}

function completedResult(result: V2CommandResult): V2CommandTerminalFrame {
  return { operationId: "operation-a", result, type: "commandCompleted" };
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
    readState: {
      kind: "read",
      latestActivityMarker: null,
      readThroughMarker: null,
      unreadCount: 0,
    },
  };
}
