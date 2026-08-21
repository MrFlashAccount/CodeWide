import type { ThreadProjectionPatchV1 } from "@codewide/sync-client";

/** A delivered native prompt can only be proven by a projected user item with
 * its stable client id. Text, reasoning and tool deltas are not evidence and
 * must never trigger a native command-table scan. */
export function operationConfirmsDeliveredCommand(
  operation: ThreadProjectionPatchV1["operation"],
): boolean {
  if (operation.kind === "itemUpsert") return isClientUserMessage(operation.item);
  if (operation.kind !== "turnStarted" && operation.kind !== "turnCompleted") return false;
  const turn = asRecord(operation.turn);
  return Array.isArray(turn?.items) && turn.items.some(isClientUserMessage);
}

function isClientUserMessage(value: unknown): boolean {
  const item = asRecord(value);
  return item?.type === "userMessage"
    && typeof item.clientId === "string"
    && item.clientId.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
