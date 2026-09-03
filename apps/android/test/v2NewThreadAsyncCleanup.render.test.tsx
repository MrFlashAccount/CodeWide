import { describe, expect, it, jest } from "@jest/globals";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import type { V2Command } from "@codewide/sync-client/v2";

import type {
  CommandCorrelationScope,
  CommandSettlement,
} from "../src/v2/application/commandCorrelation";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { savedServerId } from "../src/v2/domain/ids";
import { useNewThreadComposerSurfaces } from "../src/v2/features/threadList/useNewThreadComposerSurfaces";
import { useNewThreadSubmission } from "../src/v2/features/threadList/useNewThreadSubmission";

const serverId = savedServerId("server-a");

describe("V2 New Thread async cleanup", () => {
  it("unlocks a rejected composer action and exposes its error", async () => {
    const action = deferred<undefined>();
    const model = renderHook(() =>
      useNewThreadComposerSurfaces({
        message: "",
        onComposerAction: () => action.promise,
        onMessageChange: () => undefined,
        savedServerId: serverId,
        workspace: "/workspace",
      }),
    );

    act(() => model.result.current.selectAction("ports"));
    expect(model.result.current.actionPending).toBe(true);

    await act(async () => rejectAndFlush(action, new Error("Ports unavailable")));

    expect(model.result.current.actionPending).toBe(false);
    expect(model.result.current.actionError).toBe("Ports unavailable");
  });

  it("unlocks a rejected submission and keeps it retryable", async () => {
    const command = deferred<CommandSettlement>();
    const onSucceeded = jest.fn();
    const runtime = submissionRuntime(() => command.promise);
    const wrapper = createRuntimeWrapper(runtime);
    const model = renderHook(
      () =>
        useNewThreadSubmission({
          attachmentDraft: {} as never,
          onSucceeded,
          onThreadCreated: () => undefined,
          savedServerId: serverId,
          settings: {
            approvalPolicy: "onRequest",
            effort: null,
            model: null,
            personality: null,
            sandbox: "workspaceWrite",
          },
          skillBlocks: [],
          workspace: "/workspace",
          workspaceMode: { kind: "current" },
        }),
      { wrapper },
    );

    let result: Promise<boolean> | undefined;
    act(() => {
      result = model.result.current.submit({
        prepareInput: async () => [{ kind: "text", text: "Create feature" }],
        text: "Create feature",
      });
    });
    expect(model.result.current.submitting).toBe(true);

    await act(async () => rejectAndFlush(command, new Error("Session unavailable")));

    await expect(result).resolves.toBe(false);
    expect(model.result.current.submitting).toBe(false);
    expect(model.result.current.retryBlocked).toBe(false);
    expect(model.result.current.error).toBe("Session unavailable");
    expect(onSucceeded).not.toHaveBeenCalled();
  });

  it("submits the exact Ultra and granular settings selected by the user", async () => {
    const executeCorrelated = jest.fn(async () => completedSettlement());
    const onThreadCreated = jest.fn();
    const runtime = submissionRuntime(executeCorrelated);
    const wrapper = createRuntimeWrapper(runtime);
    const model = renderHook(
      () =>
        useNewThreadSubmission({
          attachmentDraft: {} as never,
          onSucceeded: () => undefined,
          onThreadCreated,
          savedServerId: serverId,
          settings: {
            approvalPolicy: {
              granular: {
                mcpElicitations: true,
                requestPermissions: false,
                rules: true,
                sandboxApproval: false,
                skillApproval: true,
              },
            },
            effort: "ultra",
            model: "gpt-5.6-sol",
            personality: "pragmatic",
            sandbox: { networkAccess: "restricted", type: "externalSandbox" },
          },
          skillBlocks: [],
          workspace: "/workspace",
          workspaceMode: { kind: "current" },
        }),
      { wrapper },
    );

    await act(async () => {
      await model.result.current.submit({
        prepareInput: async () => [{ kind: "text", text: "Create feature" }],
        text: "Create feature",
      });
    });

    expect(executeCorrelated).toHaveBeenCalledWith(
      { savedServerId: serverId, surface: "newThread", threadId: null },
      expect.objectContaining({
        settings: {
          approvalPolicy: {
            granular: {
              mcpElicitations: true,
              requestPermissions: false,
              rules: true,
              sandboxApproval: false,
              skillApproval: true,
            },
          },
          effort: "ultra",
          model: "gpt-5.6-sol",
          personality: "pragmatic",
          sandbox: { networkAccess: "restricted", type: "externalSandbox" },
        },
      }),
    );
    expect(onThreadCreated).toHaveBeenCalledWith("thread-a");
  });
});

function createRuntimeWrapper(runtime: V2Runtime) {
  return function RuntimeWrapper(props: PropsWithChildren): React.JSX.Element {
    return <V2RuntimeProvider runtime={runtime}>{props.children}</V2RuntimeProvider>;
  };
}

function submissionRuntime(
  executeCorrelated: (
    scope: CommandCorrelationScope,
    command: V2Command,
  ) => Promise<CommandSettlement>,
): V2Runtime {
  const currentSnapshot = { status: "ready" as const, value: [] };
  const snapshot = () => currentSnapshot;
  return {
    commandCorrelations: () => ({
      isScopeLocked: () => false,
      releaseBlocking: async () => undefined,
      retainLock: () => undefined,
      snapshot,
      subscribe: () => () => undefined,
    }),
    commands: { executeCorrelated },
  } as unknown as V2Runtime;
}

function completedSettlement(): CommandSettlement {
  return {
    correlationId: "correlation-a",
    frame: {
      operationId: "operation-a",
      result: { kind: "turn.submit", threadId: "thread-a", turnId: "turn-a" },
      type: "commandCompleted",
    },
    kind: "terminal",
    operationId: "operation-a",
  };
}

async function rejectAndFlush<T>(pending: Deferred<T>, cause: unknown): Promise<void> {
  pending.reject(cause);
  await Promise.resolve();
}

interface Deferred<T> {
  promise: Promise<T>;
  reject(cause: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}
