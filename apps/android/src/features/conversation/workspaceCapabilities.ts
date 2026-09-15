import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadWindow } from "../../data/thread-sync-types";
/** Qualified conversation operations; transport and persisted state stay with their existing lower owners. */
export type ConversationWorkspaceCapabilities = {
  loadScrollOffset(connectionId: string, threadId: string): Promise<number | null>;
  saveScrollOffset(
    connectionId: string,
    threadId: string,
    offset: number,
    historyAnchorTurnId: string | null,
    historyAnchorOffsetPx: number | null,
  ): Promise<void>;
  readThread(
    connectionId: string,
    threadId: string,
    cachedThread?: Thread | null,
    requireAuthoritative?: boolean,
    repairShortWindow?: boolean,
  ): Promise<ThreadWindow | null>;
  observeThread(
    connectionId: string,
    threadId: string,
    keepAcrossReconnect?: boolean,
  ): Promise<void>;
  loadTurnItems(connectionId: string, threadId: string, turnId: string): Promise<Turn["items"]>;
};
