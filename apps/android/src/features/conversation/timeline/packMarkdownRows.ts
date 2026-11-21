import type { Nodes } from "mdast";
import type { VirtualizedTurnPart } from "../turns/virtualizedTurnTypes";

// Keep a long document virtualized. Small neighbouring blocks can share one bubble frame.
const MAX_BLOCKS = 6;
const ROW_BUDGET = 1800;
const NODE_COST = 32;
const TEXT_CONTAINERS = new Set<Nodes["type"]>([
  "paragraph",
  "heading",
  "list",
  "listItem",
  "link",
  "strong",
  "emphasis",
  "delete",
]);

/** Groups short completed Markdown blocks without changing their AST, order or review addresses. */
export function packMarkdownRows(
  parts: readonly VirtualizedTurnPart[],
  pack: boolean,
): VirtualizedTurnPart[][] {
  if (!pack) {
    return parts.map((part) => [part]);
  }
  const rows: VirtualizedTurnPart[][] = [];
  let group: VirtualizedTurnPart[] = [];
  let cost = 0;
  for (const part of parts) {
    const size = blockCost(part);
    if (group.length >= MAX_BLOCKS || cost + size > ROW_BUDGET) {
      group = [];
      cost = 0;
    }
    if (group.length === 0) {
      rows.push(group);
    }
    group.push(part);
    cost += size;
  }
  return rows;
}

function blockCost(part: VirtualizedTurnPart): number {
  if (part.kind !== "markdownBlock") {
    return Infinity;
  }
  return textLayoutCost(part.block.node, ROW_BUDGET);
}

// The parser does not retain source positions. Bound both the text and the number of spans
// mounted together. Media, tables, code and other interactive blocks own a separate row.
function textLayoutCost(node: Nodes, remaining: number): number {
  if (node.type === "text" || node.type === "inlineCode") {
    return NODE_COST + node.value.length;
  }
  if (!TEXT_CONTAINERS.has(node.type) || !("children" in node)) {
    return Infinity;
  }
  let cost = NODE_COST;
  for (const child of node.children) {
    if (cost >= remaining) {
      return Infinity;
    }
    cost += textLayoutCost(child, remaining - cost);
  }
  return cost;
}
