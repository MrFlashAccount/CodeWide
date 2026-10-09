import type { RpcClient, SyncSnapshotThread } from "@codewide/sync-client";
import { isThread } from "./thread-cursor-sync";
import { unknownRecord } from "./unknownRecord";

/** Reads one qualified metadata row independently of bounded recent catalog pages. */
export function createThreadSummaryMetadataReader(
  getSession: (connectionId: string) => RpcClient | undefined,
) {
  return async (connectionId: string, threadId: string): Promise<SyncSnapshotThread> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Summary repair requires an active connection");
    }
    const response = unknownRecord(
      await session.rpc<unknown>("thread/read", { includeTurns: false, threadId }),
    );
    if (getSession(connectionId) !== session) {
      throw new Error("Summary metadata read was superseded");
    }
    if (!isThread(response?.thread) || response.thread.id !== threadId) {
      throw new Error("Companion returned invalid summary metadata");
    }
    return { archived: response.archived === true, thread: response.thread };
  };
}
