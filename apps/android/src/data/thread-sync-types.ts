import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import type { TransferAccess } from "./private-transfer";
import type { ThreadDetailDatabase } from "./thread-detail-database-contract";
import type { ThreadSummaryDatabase } from "./thread-summary-database";
import type { TurnControlsValue } from "./turn-controls-types";
import type { createWorkspaceSession } from "./workspace-session";

export type ThreadWindow = { nextCursor: string | null | undefined; thread: Thread };
export type ThreadTurnPage = {
  acceptedHistory: boolean;
  extendedHistory: boolean;
  nextCursor: string | null;
  turns: Turn[];
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
  clearInvalidationArchived: (key: string) => void;
  getDetails: () => ThreadDetailDatabase | null;
  getSession: (connectionId: string) => RpcClient | undefined;
  getSummaries: () => ThreadSummaryDatabase | null;
  loadTurnControls: (connectionId: string, cwd: string) => Promise<TurnControlsValue>;
  readInvalidationArchived: (key: string) => boolean | undefined;
  refreshSubagents: (connectionId: string, threadId: string) => Promise<void>;
  refreshThreadCatalog: (connectionId: string, force: boolean) => Promise<void>;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
  transferAccess: (connectionId: string, forceRefresh?: boolean) => Promise<TransferAccess>;
};
