import type { TNode } from "@native-html/render";

/** Structural identity remains stable when streaming appends sibling blocks or table rows. */
export function markupNodePath(node: TNode): string {
  return node.parent === null
    ? "markup"
    : `${markupNodePath(node.parent)}-${String(node.nodeIndex)}`;
}
