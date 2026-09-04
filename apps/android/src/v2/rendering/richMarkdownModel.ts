import type { Nodes, PhrasingContent, Root, RootContent } from "mdast";

import type { MarkdownImageReference } from "./renderingCapabilities";

export interface GithubAlertModel {
  color: string;
  label: string;
  children: RootContent[];
}

const ALERTS: Record<string, Omit<GithubAlertModel, "children">> = {
  CAUTION: { color: "#F05D65", label: "Caution" },
  IMPORTANT: { color: "#B59CFF", label: "Important" },
  NOTE: { color: "#70A7FF", label: "Note" },
  TIP: { color: "#35C778", label: "Tip" },
  WARNING: { color: "#E9872C", label: "Warning" },
};

export function markdownNodeKey(node: Nodes, prefix: string): string {
  const offset = node.position?.start.offset;
  if (offset !== undefined) return `${prefix}:${node.type}:${offset}`;
  return `${prefix}:${node.type}:${fallbackText(node)}`;
}

export function fallbackText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return `[${node.type}]`;
}

export function plainInlineText(nodes: PhrasingContent[]): string {
  let value = "";
  for (const node of nodes) {
    if (node.type === "text" || node.type === "inlineCode" || node.type === "html") {
      value += node.value;
    } else if (node.type === "break") {
      value += "\n";
    } else if ("children" in node) {
      value += plainInlineText(node.children);
    }
  }
  return value;
}

export function collectMarkdownImages(root: Root): MarkdownImageReference[] {
  const result: MarkdownImageReference[] = [];
  visitNode(root, result, undefined);
  return result;
}

export function markdownImageRevision(images: MarkdownImageReference[]): string {
  return images
    .map(
      (image) => `${image.id}\u0001${image.alt}\u0001${image.reference}\u0001${image.link ?? ""}`,
    )
    .join("\u0002");
}

function visitNode(
  node: Nodes,
  result: MarkdownImageReference[],
  imageLink: string | undefined,
): void {
  if (node.type === "image") {
    result.push({
      alt: node.alt ?? "Image",
      id: markdownNodeKey(node, "image"),
      reference: node.url,
      ...(imageLink === undefined ? {} : { link: imageLink }),
    });
  }
  if (!("children" in node) || !Array.isArray(node.children)) return;
  const childImageLink = node.type === "link" ? node.url : imageLink;
  for (const child of node.children) visitNode(child, result, childImageLink);
}

export function githubAlert(
  node: Extract<RootContent, { type: "blockquote" }>,
): GithubAlertModel | null {
  const first = node.children[0];
  if (first?.type !== "paragraph") return null;
  const firstInline = first.children[0];
  if (firstInline?.type !== "text") return null;
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+|$)/iu.exec(firstInline.value);
  const kind = match?.[1]?.toUpperCase();
  const config = kind === undefined ? undefined : ALERTS[kind];
  if (match === null || config === undefined) return null;
  const remainingText = firstInline.value.slice(match[0].length);
  const firstChildren: PhrasingContent[] =
    remainingText === ""
      ? first.children.slice(1)
      : [{ ...firstInline, value: remainingText }, ...first.children.slice(1)];
  const children: RootContent[] =
    firstChildren.length === 0
      ? node.children.slice(1)
      : [{ ...first, children: firstChildren }, ...node.children.slice(1)];
  return { ...config, children };
}
