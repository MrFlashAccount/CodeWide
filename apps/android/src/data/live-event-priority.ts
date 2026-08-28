import type { SyncEvent } from "@codewide/sync-client";

const IMMEDIATE_EVENT_METHODS = new Set([
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "thread/status/changed",
  "thread/tokenUsage/updated",
  "serverRequest/resolved",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
  "thread/realtime/error",
  "thread/realtime/closed",
  "companion/thread/progress",
  "companion/thread/invalidated",
]);

/** Normal text/tool deltas can wait for the render batch; lifecycle and user
 * decisions must flush the older deltas and become visible immediately. */
export function shouldFlushLiveEventsImmediately(events: SyncEvent[]): boolean {
  return events.some((event) => typeof event.payload.method === "string" && IMMEDIATE_EVENT_METHODS.has(event.payload.method));
}
