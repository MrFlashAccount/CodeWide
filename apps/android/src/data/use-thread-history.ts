import { useSelector } from "@legendapp/state/react";

import type { ThreadHistoryActivity, ThreadHistoryCursor, ThreadHistoryModel } from "./thread-history-model";

const IDLE_ACTIVITY: ThreadHistoryActivity = { status: "idle", error: null };

/** Remote cursor changes do not replace the mounted Legend chat window. */
export function useThreadHistoryCursor(
  model: ThreadHistoryModel | null,
  resourceId: string | null,
): ThreadHistoryCursor | null {
  return useSelector(() => model === null || resourceId === null ? null : model.cursor$(resourceId).get());
}

/** Loading/error chrome owns this narrow subscription; timeline rows never read it. */
export function useThreadHistoryActivity(
  model: ThreadHistoryModel | null,
  resourceId: string | null,
): ThreadHistoryActivity {
  return useSelector(() => model === null || resourceId === null ? IDLE_ACTIVITY : model.activity$(resourceId).get());
}
