import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";

/**
 * Keeps the expensive render-window scan stable while an append-only turn is
 * streaming. A completed turn can later receive its authoritative final text
 * without changing item count or identity, so the tail agent boundary must be
 * part of the cache key as well.
 */
export function turnProjectionTopologyRevision(turn: Pick<Turn, "items" | "status">): string {
  const tail = turn.items.at(-1);
  const tailRevision = tail?.type === "agentMessage"
    ? `${tail.id}\u0000${tail.type}\u0000${tail.phase ?? ""}\u0000${textEdgeRevision(tail.text)}`
    : `${tail?.id ?? ""}\u0000${tail?.type ?? ""}`;
  return `${turn.status}\u0000${turn.items.length}\u0000${tailRevision}`;
}

function textEdgeRevision(value: string): string {
  return `${value.length}:${value.slice(0, 48)}:${value.slice(-48)}`;
}
