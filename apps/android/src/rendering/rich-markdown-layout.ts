import type { PhrasingContent, RootContent } from "mdast";
import { parseRichMarkdown } from "@codewide/rendering-core";

export type RichMarkdownLayout = "intrinsic" | "fill";

/**
 * Yoga has no CSS `fit-content`/`max-content` sizing keyword. Keep plain text
 * in native intrinsic measurement, and opt into a concrete available width
 * only for renderers whose own layout contract needs one.
 */
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
    case "definition":
    case "html":
    case "yaml":
      return false;
    case "blockquote":
    case "code":
    case "footnoteDefinition":
    case "list":
    case "table":
    case "thematicBreak":
      return true;
    default:
      return true;
  }
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
    default:
      return false;
  }
}
