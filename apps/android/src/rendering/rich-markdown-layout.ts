import type { ListItem, PhrasingContent, RootContent } from "mdast";
import { parseRichMarkdown } from "@codewide/rendering-core";

export type RichMarkdownLayout = "intrinsic" | "fill";

/**
 * Yoga can size plain text and text-only containers intrinsically. Renderers
 * that need a concrete viewport opt into the available bubble width instead.
 */
export function richMarkdownLayout(source: string): RichMarkdownLayout {
  if (/\$\$|\\\[/u.test(source)) {
    return "fill";
  }
  return parseRichMarkdown(source).root.children.some(blockNeedsAvailableWidth)
    ? "fill"
    : "intrinsic";
}

function blockNeedsAvailableWidth(node: RootContent): boolean {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return node.children.some(inlineNeedsAvailableWidth);
    case "blockquote":
    case "footnoteDefinition":
      return node.children.some(blockNeedsAvailableWidth);
    case "list":
      return node.children.some(listItemNeedsAvailableWidth);
    case "code":
    case "table":
    case "thematicBreak":
    case "html":
      return true;
    case "definition":
    case "yaml":
      return false;
    case "break":
    case "delete":
    case "emphasis":
    case "footnoteReference":
    case "image":
    case "imageReference":
    case "inlineCode":
    case "link":
    case "linkReference":
    case "listItem":
    case "strong":
    case "tableCell":
    case "tableRow":
    case "text":
      return true;
    default:
      return true;
  }
}

function listItemNeedsAvailableWidth(item: ListItem): boolean {
  return item.children.some(blockNeedsAvailableWidth);
}

function inlineNeedsAvailableWidth(node: PhrasingContent): boolean {
  switch (node.type) {
    case "image":
    case "imageReference":
    case "html":
      return true;
    case "delete":
    case "emphasis":
    case "link":
    case "linkReference":
    case "strong":
      return node.children.some(inlineNeedsAvailableWidth);
    case "break":
    case "footnoteReference":
    case "inlineCode":
    case "text":
      return false;
    default:
      return false;
  }
}
