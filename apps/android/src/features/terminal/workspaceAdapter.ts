import type {
  ThreadBackgroundTerminalsListResponse,
  ThreadBackgroundTerminalsTerminateResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type {
  BackgroundTerminalValue,
  WorkspaceResourceDatabase,
} from "../../data/workspace-resource-database";
import { threadResourceKey } from "../../data/workspace-resource-keys";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { TerminalWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts terminal intents using retained lower authorities. */
export function createTerminalWorkspaceAdapter({
  getResources,
  getSession,
  rpcAfterAttach,
}: {
  getResources(): WorkspaceResourceDatabase;
  getSession(connectionId: string): WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): TerminalWorkspaceCapabilities {
  const listBackgroundTerminals = async (
    connectionId: string,
    threadId: string,
  ): Promise<BackgroundTerminalValue[]> => {
    const key = threadResourceKey(connectionId, threadId);
    const previous = getResources().backgroundTerminals.get(key);
    getResources().putBackgroundTerminals({
      id: key,
      connectionId,
      threadId,
      status: "loading",
      items: previous?.items ?? [],
      error: null,
    });
    const session = getSession(connectionId);
    try {
      if (session === undefined) throw new Error("Connection is not enabled");
      const response = await rpcAfterAttach<ThreadBackgroundTerminalsListResponse>(
        session,
        "thread/backgroundTerminals/list",
        { threadId, cursor: null, limit: 100 },
      );
      const items = response.data.map((terminal) => ({
        ...terminal,
        rssKb: terminal.rssKb === null ? null : String(terminal.rssKb),
      }));
      getResources().putBackgroundTerminals({
        id: key,
        connectionId,
        threadId,
        status: "ready",
        items,
        error: null,
      });
      return items;
    } catch (cause) {
      getResources().putBackgroundTerminals({
        id: key,
        connectionId,
        threadId,
        status: "error",
        items: previous?.items ?? [],
        error: errorMessage(cause),
      });
      throw cause;
    }
  };

  const terminateBackgroundTerminal = async (
    connectionId: string,
    threadId: string,
    processId: string,
  ): Promise<boolean> => {
    const session = getSession(connectionId);
    if (session === undefined) throw new Error("Connection is not enabled");
    const response = await rpcAfterAttach<ThreadBackgroundTerminalsTerminateResponse>(
      session,
      "thread/backgroundTerminals/terminate",
      { threadId, processId },
    );
    if (response.terminated) {
      const key = threadResourceKey(connectionId, threadId);
      const current = getResources().backgroundTerminals.get(key);
      if (current !== undefined)
        getResources().putBackgroundTerminals({
          id: key,
          connectionId,
          threadId,
          status: "ready",
          items: current.items.filter((terminal) => terminal.processId !== processId),
          error: null,
        });
    }
    return response.terminated;
  };
  return { listBackgroundTerminals, terminateBackgroundTerminal };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
