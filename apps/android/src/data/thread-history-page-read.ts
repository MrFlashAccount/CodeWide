import { RpcResponseError } from "@codewide/sync-client";

import type { ThreadHistorySummaryPage } from "./thread-history-summary-page";

/** A page belongs either to the captured authority or to a replaced traversal. */
export type ThreadHistoryPageRead =
  | { page: ThreadHistorySummaryPage; status: "page" }
  | { status: "superseded" };

/** A lost source/anchor resets the traversal once; transport failures remain retryable. */
export async function readThreadHistoryPage(input: {
  isCurrent: () => boolean;
  read: () => Promise<ThreadHistorySummaryPage>;
  repair: () => Promise<void>;
}): Promise<ThreadHistoryPageRead> {
  try {
    const page = await input.read();
    return input.isCurrent() ? { page, status: "page" } : { status: "superseded" };
  } catch (error) {
    if (!input.isCurrent()) {
      return { status: "superseded" };
    }
    if (!(error instanceof RpcResponseError) || error.code !== -32_021) {
      throw error;
    }
    await input.repair();
    return { status: "superseded" };
  }
}
