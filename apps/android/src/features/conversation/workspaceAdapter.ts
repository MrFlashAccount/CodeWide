import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
import { getOrCreateThreadUiState } from "../../data/thread-ui-state-initialization";

import type { ConversationWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts conversation intents using retained lower authorities. */
export function createConversationWorkspaceAdapter({
  getThreadUiState,
  readThread,
  observeThread,
  loadTurnItems,
}: {
  getThreadUiState(): ThreadUiStateDatabase | null;
  readThread: ConversationWorkspaceCapabilities["readThread"];
  observeThread: ConversationWorkspaceCapabilities["observeThread"];
  loadTurnItems: ConversationWorkspaceCapabilities["loadTurnItems"];
}): ConversationWorkspaceCapabilities {
  const loadScrollOffset = async (
    connectionId: string,
    threadId: string,
  ): Promise<number | null> => {
    return (await getOrCreateThreadUiState(connectionId, threadId, getThreadUiState()))
      .scrollOffset;
  };

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
  return { loadScrollOffset, saveScrollOffset, readThread, observeThread, loadTurnItems };
}
function requireThreadUiStateDatabase(
  database: ThreadUiStateDatabase | null,
): ThreadUiStateDatabase {
  if (database === null) throw new Error("Local thread UI state is not ready");
  return database;
}
