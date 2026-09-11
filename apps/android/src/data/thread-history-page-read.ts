import { RpcResponseError } from "@codewide/sync-client";

import type { ThreadHistorySummaryPage } from "./thread-history-summary-page";

/** A page belongs either to the captured authority or to a replaced traversal. */
export type ThreadHistoryPageRead =
  | { status: "page"; page: ThreadHistorySummaryPage }
  | { status: "superseded" };

/** A lost source/anchor resets the traversal once; transport failures remain retryable. */
export async function readThreadHistoryPage(input: {
  read(): Promise<ThreadHistorySummaryPage>;
  isCurrent(): boolean;
  repair(): Promise<void>;
}): Promise<ThreadHistoryPageRead> {
  try {
    const page = await input.read();
    return input.isCurrent() ? { status: "page", page } : { status: "superseded" };
  } catch (cause) {
    if (!input.isCurrent()) return { status: "superseded" };
    if (!(cause instanceof RpcResponseError) || cause.code !== -32021) throw cause;
    await input.repair();
    return { status: "superseded" };
  }
}
