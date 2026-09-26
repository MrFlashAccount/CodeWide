import type { ThreadForkResponse } from "@codewide/codex-protocol/v0.155.1/v2";
import { randomUUID } from "expo-crypto";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import { buildThreadForkParams, type ThreadForkOptions } from "../../data/thread-fork";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";
import { enqueueNativeCommand } from "../../native/native-transport";

import type { TurnActionsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts turnActions intents using retained lower authorities. */
export function createTurnActionsWorkspaceAdapter({
  getDetails,
  getSession,
  getSummaries,
  getThreadUiState,
  rpcAfterAttach,
}: {
  getDetails: () => ThreadDetailDatabase | null;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  getSummaries: () => ThreadSummaryDatabase | null;
  getThreadUiState: () => ThreadUiStateDatabase | null;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): TurnActionsWorkspaceCapabilities {
  const setThreadPinned = async (connectionId: string, threadId: string, pinned: boolean) => {
    await requireThreadSummaryDatabase(getSummaries()).updatePinned(connectionId, threadId, pinned);
  };

  const renameThread = async (
    connectionId: string,
    threadId: string,
    name: string,
  ): Promise<void> => {
    await requireThreadSummaryDatabase(getSummaries()).updateName(connectionId, threadId, name);
  };

  const archiveThread = async (connectionId: string, threadId: string): Promise<void> => {
    await enqueueNativeCommand(connectionId, `thread-archive-${randomUUID()}`, "thread/archive", {
      threadId,
    });
    await requireThreadSummaryDatabase(getSummaries()).updateArchived(connectionId, threadId, true);
  };

  const unarchiveThread = async (connectionId: string, threadId: string): Promise<void> => {
    await enqueueNativeCommand(
      connectionId,
      `thread-unarchive-${randomUUID()}`,
      "thread/unarchive",
      { threadId },
    );
    await requireThreadSummaryDatabase(getSummaries()).updateArchived(
      connectionId,
      threadId,
      false,
    );
  };

  const deleteThread = async (connectionId: string, threadId: string): Promise<void> => {
    const commandId = `thread-delete-${randomUUID()}`;
    const summaries = requireThreadSummaryDatabase(getSummaries());
    await summaries.beginDelete(connectionId, threadId, commandId);
    try {
      await enqueueNativeCommand(connectionId, commandId, "thread/delete", { threadId });
      await getThreadUiState()?.deleteThread(connectionId, threadId);
    } catch (error) {
      await summaries.rollbackDelete(connectionId, threadId, commandId);
      throw error;
    }
  };

  const markThreadRead = async (connectionId: string, threadId: string): Promise<void> => {
    await getSummaries()?.markRead(connectionId, threadId);
  };
  const markThreadUnread = async (connectionId: string, threadId: string): Promise<void> => {
    await getSummaries()?.markUnread(connectionId, threadId);
  };

  const interruptTurn = async (connectionId: string, threadId: string, turnId: string) => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    // Interrupt is an ephemeral control-plane action. Persisting it behind
    // the durable mutation outbox can make Stop wait for an unrelated turn
    // reconciliation and can replay a stale stop after reconnect.
    await rpcAfterAttach(session, "turn/interrupt", { threadId, turnId });
  };

  const forkThread = async (
    connectionId: string,
    threadId: string,
    options: ThreadForkOptions,
  ): Promise<string> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<ThreadForkResponse>(
      session,
      "thread/fork",
      buildThreadForkParams(threadId, options),
    );
    await getDetails()?.importThreadSnapshot(connectionId, response.thread, "fork");
    return response.thread.id;
  };

  const compactThread = async (connectionId: string, threadId: string): Promise<void> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    await rpcAfterAttach(session, "thread/compact/start", { threadId });
  };
  return {
    archiveThread,
    compactThread,
    deleteThread,
    forkThread,
    interruptTurn,
    markThreadRead,
    markThreadUnread,
    renameThread,
    setThreadPinned,
    unarchiveThread,
  };
}
function requireThreadSummaryDatabase(
  database: ThreadSummaryDatabase | null,
): ThreadSummaryDatabase {
  if (database === null) {
    throw new Error("Local thread summaries are not ready");
  }
  return database;
}
