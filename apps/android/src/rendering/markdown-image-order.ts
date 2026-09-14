import type { Nodes } from "mdast";

/** Keeps image gallery order independent of which document blocks are mounted. */
export function collectMarkdownImageOrder(root: Nodes): WeakMap<object, number> {
  const order = new WeakMap<object, number>();
  let index = 0;
  const visit = (node: Nodes): void => {
    if (node.type === "image") {
      order.set(node, index);
      index += 1;
    }
    if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(root);
  return order;
}
