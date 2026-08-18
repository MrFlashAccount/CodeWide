import type { Thread, ThreadItem } from "@codewide/codex-protocol/v0.147.0/v2";

import { itemKey, threadKey, turnKey } from "./identity";
import type { ConnectionId, NormalizedItem, NormalizedThread } from "./model";

export const KNOWN_ITEM_TYPES = new Set([
  "userMessage",
  "agentMessage",
  "plan",
  "reasoning",
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "hookPrompt",
  "collabAgentToolCall",
  "subAgentActivity",
  "webSearch",
  "imageView",
  "sleep",
  "imageGeneration",
  "enteredReviewMode",
  "exitedReviewMode",
  "contextCompaction",
]);

export function normalizeThreadItem(
  connection: ConnectionId,
  remoteThreadId: string,
  turnId: string,
  rawItem: ThreadItem | Record<string, unknown>,
  index: number,
): NormalizedItem {
  const type = typeof rawItem.type === "string" ? rawItem.type : "unknown";
  const rawId = rawItem.id;
  const itemId = typeof rawId === "string" && rawId.length > 0 ? rawId : `anonymous-${index}`;
  return {
    key: itemKey(connection, remoteThreadId, turnId, itemId),
    connectionId: connection,
    threadId: remoteThreadId,
    turnId,
    itemId,
    type,
    payload: rawItem,
    unknown: !KNOWN_ITEM_TYPES.has(type),
  };
}

export function normalizeThread(connection: ConnectionId, thread: Thread): NormalizedThread {
  return {
    key: threadKey(connection, thread.id),
    connectionId: connection,
    remoteId: thread.id,
    name: thread.name,
    preview: thread.preview,
    cwd: thread.cwd,
    updatedAt: thread.updatedAt,
    recencyAt: thread.recencyAt,
    status: thread.status,
    turns: thread.turns.map((turn) => normalizeTurn(connection, thread.id, turn)),
  };
}

export function normalizeTurn(
  connection: ConnectionId,
  remoteThreadId: string,
  turn: Thread["turns"][number],
): NormalizedThread["turns"][number] {
  return {
    key: turnKey(connection, remoteThreadId, turn.id),
    id: turn.id,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    durationMs: turn.durationMs,
    items: turn.items.map((item, index) =>
      normalizeThreadItem(connection, remoteThreadId, turn.id, item, index),
    ),
  };
}
