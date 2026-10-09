import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
import { getOrCreateThreadUiState } from "../../data/thread-ui-state-initialization";
import type { createThreadSummaryMetadataReader } from "../../data/threadSummaryMetadata";

import type { ConversationWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts conversation intents using retained lower authorities. */
export function createConversationWorkspaceAdapter({
  getThreadUiState,
  loadTurnItems,
  observeThread,
  readThread,
  readThreadSummary,
}: {
  getThreadUiState: () => ThreadUiStateDatabase | null;
  loadTurnItems: ConversationWorkspaceCapabilities["loadTurnItems"];
  observeThread: ConversationWorkspaceCapabilities["observeThread"];
  readThread: ConversationWorkspaceCapabilities["readThread"];
  readThreadSummary: ReturnType<typeof createThreadSummaryMetadataReader>;
}): ConversationWorkspaceCapabilities {
  const loadScrollOffset = async (connectionId: string, threadId: string): Promise<number | null> =>
    (await getOrCreateThreadUiState(connectionId, threadId, getThreadUiState())).scrollOffset;

  const saveScrollOffset = async (
    connectionId: string,
    threadId: string,
    offset: number,
    historyAnchorTurnId: string | null,
    historyAnchorOffsetPx: number | null,
  ): Promise<void> => {
    await requireThreadUiStateDatabase(getThreadUiState()).saveScrollOffset(
      connectionId,
      threadId,
      offset,
      historyAnchorTurnId,
      historyAnchorOffsetPx,
    );
  };
  const readThreadMetadata: ConversationWorkspaceCapabilities["readThreadMetadata"] = async (
    connectionId,
    threadId,
  ) => (await readThreadSummary(connectionId, threadId)).thread;
  return {
    loadScrollOffset,
    loadTurnItems,
    observeThread,
    readThread,
    readThreadMetadata,
    saveScrollOffset,
  };
}
function requireThreadUiStateDatabase(
  database: ThreadUiStateDatabase | null,
): ThreadUiStateDatabase {
  if (database === null) {
    throw new Error("Local thread UI state is not ready");
  }
  return database;
}
