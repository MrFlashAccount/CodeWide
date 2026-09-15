import type { ThreadProjectionPatchV1 } from "@codewide/sync-client";

/** Content-free proof that App Server materialized one explicitly sent command. */
export type CommandReceipt = {
  readonly threadId: string;
  readonly commandId: string;
  readonly turnId: string;
  readonly itemId: string;
};

/** Extracts evidence before the optional resident conversation projection. */
export function commandReceiptsFromOperation(
  threadId: string,
  operation: ThreadProjectionPatchV1["operation"],
): CommandReceipt[] {
  if (operation.kind === "itemUpsert")
    return itemReceipts(threadId, operation.turnId, operation.item);
  if (operation.kind === "turnStarted" || operation.kind === "turnCompleted") {
    return commandReceiptsFromTurn(threadId, operation.turn);
  }
  return [];
}

/** Snapshot and event evidence use the same identity contract. */
export function commandReceiptsFromTurn(threadId: string, value: unknown): CommandReceipt[] {
  const turn = asRecord(value);
  if (turn === null || !Array.isArray(turn.items)) return [];
  return turn.items.flatMap((item: unknown) => itemReceipts(threadId, turn.id, item));
}

function itemReceipts(threadId: string, turnId: unknown, value: unknown): CommandReceipt[] {
  const item = asRecord(value);
  if (
    threadId.length === 0 ||
    typeof turnId !== "string" ||
    turnId.length === 0 ||
    item?.type !== "userMessage" ||
    typeof item.id !== "string" ||
    item.id.length === 0 ||
    typeof item.clientId !== "string" ||
    item.clientId.length === 0
  )
    return [];
  return [{ threadId, commandId: item.clientId, turnId, itemId: item.id }];
}

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
  return (
    item?.type === "userMessage" && typeof item.clientId === "string" && item.clientId.length > 0
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? // WHY: JS object narrowing does not provide an index signature. This boundary
      // only reads unknown properties, which are individually validated above.
      (value as Record<string, unknown>)
    : null;
}
