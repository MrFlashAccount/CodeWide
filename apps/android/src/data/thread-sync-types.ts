import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import type { TransferAccess } from "./private-transfer";
import type { ThreadDetailDatabase } from "./thread-detail-database-contract";
import type { ThreadSummaryDatabase } from "./thread-summary-database";
import type { TurnControlsValue } from "./turn-controls-types";
import type { createWorkspaceSession } from "./workspace-session";
export type ThreadWindow = { thread: Thread; nextCursor: string | null | undefined };
export type ThreadTurnPage = {
  turns: Turn[];
  nextCursor: string | null;
  acceptedHistory: boolean;
  extendedHistory: boolean;
};
export type ThreadReadOperation = (
  connectionId: string,
  threadId: string,
  cachedThread?: Thread | null,
  requireAuthoritative?: boolean,
  repairShortWindow?: boolean,
) => Promise<ThreadWindow | null>;
export type CaptureThreadHistoryRead = (
  connectionId: string,
  session: RpcClient,
  details: ThreadDetailDatabase,
) => () => boolean;
/** Existing lower read, projection and related resource authorities. */
export type ThreadSyncAuthority = {
  getDetails(): ThreadDetailDatabase | null;
  getSummaries(): ThreadSummaryDatabase | null;
  getSession(connectionId: string): RpcClient | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
  refreshSubagents(connectionId: string, threadId: string): Promise<void>;
  loadTurnControls(connectionId: string, cwd: string): Promise<TurnControlsValue>;
  transferAccess(connectionId: string, forceRefresh?: boolean): Promise<TransferAccess>;
  readInvalidationArchived(key: string): boolean | undefined;
  clearInvalidationArchived(key: string): void;
  refreshThreadCatalog(connectionId: string, force: boolean): Promise<void>;
};
