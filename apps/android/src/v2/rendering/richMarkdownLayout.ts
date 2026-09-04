import type { ListItem, PhrasingContent, RootContent } from "mdast";
import { parseRichMarkdown } from "@codewide/rendering-core";

export type RichMarkdownLayout = "fill" | "intrinsic";

/** Selects the bubble width required by the rendered Markdown structure. */
export function richMarkdownLayout(source: string): RichMarkdownLayout {
  return parseRichMarkdown(source).root.children.some(blockNeedsAvailableWidth)
    ? "fill"
    : "intrinsic";
}

function blockNeedsAvailableWidth(node: RootContent): boolean {
  switch (node.type) {
    case "paragraph":
    case "heading":
      return node.children.some(inlineNeedsAvailableWidth);
    case "delete":
    case "emphasis":
    case "link":
    case "linkReference":
    case "strong":
      return node.children.some(inlineNeedsAvailableWidth);
    case "blockquote":
    case "footnoteDefinition":
      return node.children.some(blockNeedsAvailableWidth);
    case "list":
      return node.children.some(listItemNeedsAvailableWidth);
    case "listItem":
      return node.children.some(blockNeedsAvailableWidth);
    case "code":
    case "image":
    case "imageReference":
    case "table":
    case "tableCell":
    case "tableRow":
    case "thematicBreak":
      return true;
    case "break":
    case "definition":
    case "footnoteReference":
    case "html":
    case "inlineCode":
    case "text":
    case "yaml":
      return false;
    default:
      return unreachableBlock(node);
  }
}

function listItemNeedsAvailableWidth(item: ListItem): boolean {
  return item.children.some(blockNeedsAvailableWidth);
}

function inlineNeedsAvailableWidth(node: PhrasingContent): boolean {
  switch (node.type) {
    case "image":
    case "imageReference":
      return true;
    case "delete":
    case "emphasis":
    case "link":
    case "linkReference":
    case "strong":
      return node.children.some(inlineNeedsAvailableWidth);
    case "break":
    case "footnoteReference":
    case "html":
    case "inlineCode":
    case "text":
      return false;
    default:
      return unreachableInline(node);
  }
}

function unreachableBlock(_node: never): boolean {
  return false;
}

function unreachableInline(_node: never): boolean {
  return false;
}
