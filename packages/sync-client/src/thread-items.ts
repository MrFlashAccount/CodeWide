import type { ThreadItem } from "@codewide/codex-protocol/v0.147.0/v2";

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
    result[index] = preserveUserClientId(item, result[index]!);
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
  return left.text === right.text
    || (left.phase === "final_answer" && right.phase === "final_answer");
}

function preserveUserClientId(incoming: ThreadItem, cached: ThreadItem): ThreadItem {
  if (incoming.type !== "userMessage" || cached.type !== "userMessage") return incoming;
  if (nonEmpty(incoming.clientId) !== null) return incoming;
  const clientId = nonEmpty(cached.clientId);
  return clientId === null ? incoming : { ...incoming, clientId };
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
