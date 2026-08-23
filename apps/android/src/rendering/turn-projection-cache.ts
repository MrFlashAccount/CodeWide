import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";

/**
 * Keeps the component-local render-window scan stable while an append-only
 * turn is streaming. The cache itself lives in the mounted turn component,
 * so this revision does not retain an inactive conversation.
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
