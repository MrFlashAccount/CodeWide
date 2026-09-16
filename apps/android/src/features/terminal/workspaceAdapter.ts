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
  getResources: () => WorkspaceResourceDatabase;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): TerminalWorkspaceCapabilities {
  const listBackgroundTerminals = async (
    connectionId: string,
    threadId: string,
  ): Promise<BackgroundTerminalValue[]> => {
    const key = threadResourceKey(connectionId, threadId);
    const previous = getResources().backgroundTerminals.get(key);
    getResources().putBackgroundTerminals({
      connectionId,
      error: null,
      id: key,
      items: previous?.items ?? [],
      status: "loading",
      threadId,
    });
    const session = getSession(connectionId);
    try {
      if (session === undefined) {
        throw new Error("Connection is not enabled");
      }
      const response = await rpcAfterAttach<ThreadBackgroundTerminalsListResponse>(
        session,
        "thread/backgroundTerminals/list",
        { cursor: null, limit: 100, threadId },
      );
      const items = response.data.map((terminal) => ({
        ...terminal,
        rssKb: terminal.rssKb === null ? null : String(terminal.rssKb),
      }));
      getResources().putBackgroundTerminals({
        connectionId,
        error: null,
        id: key,
        items,
        status: "ready",
        threadId,
      });
      return items;
    } catch (error) {
      getResources().putBackgroundTerminals({
        connectionId,
        error: errorMessage(error),
        id: key,
        items: previous?.items ?? [],
        status: "error",
        threadId,
      });
      throw error;
    }
  };

  const terminateBackgroundTerminal = async (
    connectionId: string,
    threadId: string,
    processId: string,
  ): Promise<boolean> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<ThreadBackgroundTerminalsTerminateResponse>(
      session,
      "thread/backgroundTerminals/terminate",
      { processId, threadId },
    );
    if (response.terminated) {
      const key = threadResourceKey(connectionId, threadId);
      const current = getResources().backgroundTerminals.get(key);
      if (current !== undefined) {
        getResources().putBackgroundTerminals({
          connectionId,
          error: null,
          id: key,
          items: current.items.filter((terminal) => terminal.processId !== processId),
          status: "ready",
          threadId,
        });
      }
    }
    return response.terminated;
  };
  return { listBackgroundTerminals, terminateBackgroundTerminal };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
