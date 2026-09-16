import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadWindow } from "../../data/thread-sync-types";
/** Qualified conversation operations; transport and persisted state stay with their existing lower owners. */
export type ConversationWorkspaceCapabilities = {
  loadScrollOffset: (connectionId: string, threadId: string) => Promise<number | null>;
  loadTurnItems: (connectionId: string, threadId: string, turnId: string) => Promise<Turn["items"]>;
  observeThread: (
    connectionId: string,
    threadId: string,
    keepAcrossReconnect?: boolean,
  ) => Promise<void>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  readThread: (
    connectionId: string,
    threadId: string,
    cachedThread?: Thread | null,
    requireAuthoritative?: boolean,
    repairShortWindow?: boolean,
  ) => Promise<ThreadWindow | null>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  saveScrollOffset: (
    connectionId: string,
    threadId: string,
    offset: number,
    historyAnchorTurnId: string | null,
    historyAnchorOffsetPx: number | null,
  ) => Promise<void>;
};
