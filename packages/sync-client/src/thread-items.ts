import type { ThreadItem } from "@codewide/codex-protocol/v0.155.1/v2";

/**
 * Reconciles two projections of the same protocol turn.
 *
 * Item ids are the primary identity, but reconstructed history and live App
 * Server events can assign different ids to the same user/final-agent boundary.
 * Matching those boundaries as a multiset keeps legitimate repeated progress
 * messages while preventing cached + summary + full projections from stacking
 * identical chat messages in the UI.
 */
export function reconcileTurnItems(
  cached: readonly ThreadItem[],
  incoming: readonly ThreadItem[],
): ThreadItem[] {
  return reconcileItems(cached, incoming, false);
}

/**
 * Reconciles an active-turn snapshot without treating a context-compaction
 * item as proof that the previously observed lifecycle has completed. That
 * protocol item has no status field, so the matching live item event remains
 * the authority for advancing its lifecycle.
 */
export function reconcileActiveTurnItems(
  cached: readonly ThreadItem[],
  incoming: readonly ThreadItem[],
): ThreadItem[] {
  return reconcileItems(cached, incoming, true);
}

function reconcileItems(
  cached: readonly ThreadItem[],
  incoming: readonly ThreadItem[],
  preserveLifecycle: boolean,
): ThreadItem[] {
  if (cached.length === 0) return incoming.slice();
  if (incoming.length === 0) return cached.slice();

  const result = cached.slice();
  const matched = new Set<number>();
  const leading: ThreadItem[] = [];
  const trailing: ThreadItem[] = [];

  for (const item of incoming) {
    let index = result.findIndex((candidate, candidateIndex) => (
      !matched.has(candidateIndex) && candidate.id === item.id
    ));
    if (index === -1 && isChatBoundary(item)) {
      index = result.findIndex((candidate, candidateIndex) => (
        !matched.has(candidateIndex) && sameLogicalBoundary(candidate, item)
      ));
    }
    if (index === -1) {
      (item.type === "userMessage" ? leading : trailing).push(item);
      continue;
    }
    result[index] = preserveProjectedItemMarkers(item, result[index]!, preserveLifecycle);
    matched.add(index);
  }

  return [...leading, ...result, ...trailing];
}

function isChatBoundary(item: ThreadItem): boolean {
  return item.type === "userMessage" || item.type === "agentMessage";
}

function sameLogicalBoundary(left: ThreadItem, right: ThreadItem): boolean {
  if (left.type === "userMessage" && right.type === "userMessage") {
    if (nonEmpty(left.clientId) !== null && left.clientId === right.clientId) return true;
    return userMessageFingerprint(left) === userMessageFingerprint(right);
  }
  if (left.type !== "agentMessage" || right.type !== "agentMessage") return false;
  // Async questions share final_answer with the eventual result, but each
  // message owns a separate interaction. Only its item id may reconcile it.
  if (left.delivery === "async" || right.delivery === "async") return false;
  return left.text === right.text
    || (left.phase === "final_answer" && right.phase === "final_answer");
}

function preserveUserClientId(incoming: ThreadItem, cached: ThreadItem): ThreadItem {
  if (incoming.type !== "userMessage" || cached.type !== "userMessage") return incoming;
  if (nonEmpty(incoming.clientId) !== null) return incoming;
  const clientId = nonEmpty(cached.clientId);
  return clientId === null ? incoming : { ...incoming, clientId };
}

function preserveProjectedItemMarkers(
  incoming: ThreadItem,
  cached: ThreadItem,
  preserveLifecycle: boolean,
): ThreadItem {
  let projected = preserveActiveAgentText(incoming, cached, preserveLifecycle);
  projected = preserveUserClientId(projected, cached);
  if (projectedPreTurn(cached) && !projectedPreTurn(projected)) {
    projected = withProjectedPreTurn(projected);
  }
  const lifecyclePhase =
    preserveLifecycle && projected.type === "contextCompaction"
      ? projectedLifecyclePhase(cached)
      : null;
  if (lifecyclePhase !== null && projectedLifecyclePhase(projected) === null) {
    projected = withProjectedLifecycle(projected, lifecyclePhase);
  }
  return projected;
}

function preserveActiveAgentText(
  incoming: ThreadItem,
  cached: ThreadItem,
  preserveLifecycle: boolean,
): ThreadItem {
  if (
    !preserveLifecycle ||
    incoming.type !== "agentMessage" ||
    cached.type !== "agentMessage" ||
    !cached.text.startsWith(incoming.text) ||
    cached.text === incoming.text
  ) {
    return incoming;
  }
  return { ...incoming, text: cached.text };
}

function withProjectedPreTurn<Item extends ThreadItem>(item: Item): Item & { codewidePreTurn: true } {
  return Object.assign({}, item, { codewidePreTurn: true as const });
}

function withProjectedLifecycle<Item extends ThreadItem>(
  item: Item,
  phase: "completed" | "started",
): Item & { codewideLifecyclePhase: "completed" | "started" } {
  return Object.assign({}, item, { codewideLifecyclePhase: phase });
}

function projectedPreTurn(item: ThreadItem): boolean {
  return "codewidePreTurn" in item && item.codewidePreTurn === true;
}

function projectedLifecyclePhase(item: ThreadItem): "completed" | "started" | null {
  if (!("codewideLifecyclePhase" in item)) return null;
  const phase = item.codewideLifecyclePhase;
  return phase === "started" || phase === "completed" ? phase : null;
}

function userMessageFingerprint(item: Extract<ThreadItem, { type: "userMessage" }>): string {
  const text = item.content
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n")
    .trim();
  return text === "" ? JSON.stringify(item.content) : text;
}

function nonEmpty(value: string | null): string | null {
  return value === null || value === "" ? null : value;
}
