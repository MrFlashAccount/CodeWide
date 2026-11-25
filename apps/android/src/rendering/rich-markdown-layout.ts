import type { ListItem, PhrasingContent, RootContent } from "mdast";
import {
  parseRichMarkdown,
  projectCompleteMarkdown,
  TARGET_MARKDOWN_SEGMENT_CHARS,
  type ParsedRichMarkdown,
} from "@codewide/rendering-core";

export type RichMarkdownLayout = "intrinsic" | "fill";

/** A bounded piece of the source paired with the tree used to lay it out and render it. */
export type ParsedMarkdownSegment = {
  readonly parsed: ParsedRichMarkdown;
  readonly source: string;
};

const displayMath = /\$\$|\\\[/u;

/** Reads the width requirement directly from the segment that will be rendered. */
export function segmentNeedsAvailableWidth(segment: ParsedMarkdownSegment): boolean {
  return (
    displayMath.test(segment.source) || segment.parsed.root.children.some(blockNeedsAvailableWidth)
  );
}

/** Computes an enclosing bubble's width from the same bounded inputs as its settled content. */
export function completeMarkdownLayout(source: string): RichMarkdownLayout {
  if (source.length < TARGET_MARKDOWN_SEGMENT_CHARS) {
    return richMarkdownLayout(source);
  }
  return projectCompleteMarkdown(source).some((segment) => richMarkdownLayout(segment) === "fill")
    ? "fill"
    : "intrinsic";
}

/**
 * Yoga can size plain text and text-only containers intrinsically. Renderers
 * that need a concrete viewport opt into the available bubble width instead.
 */
export function richMarkdownLayout(source: string): RichMarkdownLayout {
  if (displayMath.test(source)) {
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
