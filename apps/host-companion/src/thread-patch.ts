type RpcObject = Record<string, unknown>;

export const THREAD_PATCH_FIELD = "codewideThreadPatch";
export const THREAD_PATCH_VERSION = 1;

export const THREAD_PATCH_OPERATIONS = [
  { method: "thread/status/changed", kind: "threadStatus" },
  { method: "thread/name/updated", kind: "threadName" },
  { method: "thread/deleted", kind: "threadDeleted" },
  { method: "thread/settings/updated", kind: "threadSettings" },
  { method: "thread/started", kind: "threadStarted" },
  { method: "thread/archived", kind: "threadArchived", archived: true },
  { method: "thread/unarchived", kind: "threadArchived", archived: false },
  { method: "turn/started", kind: "turnStarted" },
  { method: "turn/completed", kind: "turnCompleted" },
  { method: "model/rerouted", kind: "modelRerouted" },
  { method: "item/started", kind: "itemUpsert" },
  { method: "item/completed", kind: "itemUpsert" },
  { method: "item/agentMessage/delta", kind: "itemTextDelta", itemType: "agentMessage" },
  { method: "item/plan/delta", kind: "itemTextDelta", itemType: "plan" },
  { method: "item/commandExecution/outputDelta", kind: "itemTextDelta", itemType: "commandExecution" },
  { method: "item/fileChange/patchUpdated", kind: "fileChanges" },
  { method: "item/mcpToolCall/progress", kind: "mcpProgress" },
  { method: "thread/tokenUsage/updated", kind: "tokenUsage" },
  { method: "turn/diff/updated", kind: "turnDiff" },
  { method: "turn/plan/updated", kind: "turnPlan" },
  { method: "item/reasoning/summaryPartAdded", kind: "reasoningPart", field: "summary" },
  { method: "item/reasoning/summaryTextDelta", kind: "reasoningDelta", field: "summary" },
  { method: "item/reasoning/textDelta", kind: "reasoningDelta", field: "content" },
] as const;

export function attachThreadPatch(message: RpcObject): RpcObject {
  const patch = compileThreadPatch(message);
  return patch === null ? message : { ...message, [THREAD_PATCH_FIELD]: patch };
}

export function compileThreadPatch(message: RpcObject): RpcObject | null {
  const method = typeof message.method === "string" ? message.method : null;
  const params = asObject(message.params);
  const thread = asObject(params?.thread);
  const threadId = typeof params?.threadId === "string"
    ? params.threadId
    : typeof thread?.id === "string" ? thread.id : null;
  if (method === null || params === null || threadId === null) return null;
  const operation = THREAD_PATCH_OPERATIONS.find((candidate) => candidate.method === method);
  if (operation === undefined) return null;
  const { method: _method, ...semanticOperation } = operation;
  const summary = summaryProjection(method, params);
  return {
    version: THREAD_PATCH_VERSION,
    threadId,
    operation: summary === null ? semanticOperation : { ...semanticOperation, summary },
  };
}

function summaryProjection(method: string, params: RpcObject): RpcObject | null {
  if (!isThreadActivity(method)) return null;
  const turn = asObject(params.turn);
  const item = asObject(params.item);
  const finalAgentResponse = method === "turn/completed" && turnHasAgentResponse(turn);
  return {
    activity: true,
    conversationMessage: finalAgentResponse || turnHasUserMessage(turn) || item?.type === "userMessage",
    finalAgentResponse,
    previewText: previewFromEvent(method, turn, item),
  };
}

function previewFromEvent(method: string, turn: RpcObject | null, item: RpcObject | null): string | null {
  if (method === "turn/started" || method === "turn/completed") {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    if (method === "turn/completed") {
      const final = latestItemText(items, (candidate) => candidate.type === "agentMessage" && candidate.phase === "final_answer");
      if (final !== null) return final;
    }
    return latestItemText(items, (candidate) => candidate.type === "agentMessage" || candidate.type === "userMessage");
  }
  if (method === "item/started" || method === "item/completed") {
    if (item?.type === "agentMessage" && item.phase === "final_answer") return null;
    return itemText(item);
  }
  return null;
}

function latestItemText(items: unknown[], accepts: (item: RpcObject) => boolean): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = asObject(items[index]);
    if (item === null || !accepts(item)) continue;
    const text = itemText(item);
    if (text !== null) return text;
  }
  return null;
}

function itemText(item: RpcObject | null): string | null {
  if (item?.type === "agentMessage" && typeof item.text === "string" && item.text.trim() !== "") {
    return item.text.slice(0, 2_000);
  }
  if (item?.type !== "userMessage" || !Array.isArray(item.content)) return null;
  const text = item.content.flatMap((part) => {
    const value = asObject(part);
    return value?.type === "text" && typeof value.text === "string" ? [value.text] : [];
  }).join(" ").trim();
  return text === "" ? null : text.slice(0, 2_000);
}

function turnHasAgentResponse(turn: RpcObject | null): boolean {
  return Array.isArray(turn?.items) && turn.items.some((raw) => {
    const item = asObject(raw);
    return item?.type === "agentMessage" && typeof item.text === "string" && item.text.trim() !== "";
  });
}

function turnHasUserMessage(turn: RpcObject | null): boolean {
  return Array.isArray(turn?.items) && turn.items.some((raw) => asObject(raw)?.type === "userMessage");
}

function isThreadActivity(method: string): boolean {
  return method.startsWith("turn/") || method.startsWith("item/") || method === "thread/tokenUsage/updated";
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RpcObject
    : null;
}
