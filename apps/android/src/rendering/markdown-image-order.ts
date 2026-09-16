import type { Nodes } from "mdast";

export type MarkdownImageNode = Extract<Nodes, { type: "image" }>;

/** Keeps image gallery order independent of which document blocks are mounted. */
export function collectMarkdownImageOrder(root: Nodes): WeakMap<MarkdownImageNode, number> {
  const order = new WeakMap<MarkdownImageNode, number>();
  let index = 0;
  const visit = (node: Nodes): void => {
    if (node.type === "image") {
      order.set(node, index);
      index += 1;
    }
    if ("children" in node) {
      for (const child of node.children) {
        visit(child);
      }
    }
  };
  visit(root);
  return order;
}
