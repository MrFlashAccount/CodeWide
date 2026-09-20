import type { Nodes } from "mdast";

import { textFingerprint } from "./listKey";

/** Keeps an existing Markdown subtree mounted while its append-only tail grows. */
export function markdownNodeIdentity(node: Nodes, fallback: string): string {
  const start = node.position?.start.offset;
  if (start !== undefined) {
    return `${node.type}:${String(start)}`;
  }
  return `${node.type}:${textFingerprint(fallback)}`;
}
