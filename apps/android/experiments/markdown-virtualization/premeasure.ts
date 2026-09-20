import type { PhrasingContent, RootContent } from "mdast";
import { plainRichMarkdownRootText } from "@codewide/rendering-core";
import {
  layout,
  measureCodeBlockHeight,
  measureInlineFlow,
  prepare,
  prepareInlineFlow,
  type InlineFlowItem,
  type TextStyle,
} from "expo-pretext";

import type { MarkdownDocumentBlock } from "../../src/rendering/markdown-document-blocks";

export const BUBBLE_WIDTH = 620;
export const BUBBLE_HORIZONTAL_PADDING = 22;
export const BLOCK_CONTENT_WIDTH = BUBBLE_WIDTH - BUBBLE_HORIZONTAL_PADDING * 2;

const PARAGRAPH_STYLE = {
  fontFamily: "System",
  fontSize: 15,
  fontWeight: "400",
  lineHeight: 23,
} satisfies TextStyle;
const HEADING_STYLE = {
  fontFamily: "System",
  fontSize: 19,
  fontWeight: "700",
  lineHeight: 26,
} satisfies TextStyle;
const CODE_STYLE = {
  fontFamily: "monospace",
  fontSize: 13,
  fontWeight: "400",
  lineHeight: 20,
} satisfies TextStyle;
const TABLE_STYLE = {
  fontFamily: "System",
  fontSize: 12,
  fontWeight: "400",
  lineHeight: 18,
} satisfies TextStyle;

/** Predicts the complete Legend item height for the deterministic experiment renderer. */
export function premeasureMarkdownBlock(
  block: MarkdownDocumentBlock,
  index: number,
  totalBlocks: number,
): number {
  const firstSegmentPadding = index === 0 ? 18 : 0;
  const lastSegmentPadding = index === totalBlocks - 1 ? 18 : 0;
  return Math.ceil(
    measureBlockNode(block.node, BLOCK_CONTENT_WIDTH) + firstSegmentPadding + lastSegmentPadding,
  );
}

function measureBlockNode(node: RootContent, width: number): number {
  switch (node.type) {
    case "heading":
      return measureInline(node.children, HEADING_STYLE, width) + 14 + 8;
    case "paragraph":
      return measureInline(node.children, PARAGRAPH_STYLE, width) + 8;
    case "blockquote":
      return sumBlockChildren(node.children, width - 13) + 8;
    case "list": {
      const bodyWidth = width - 28;
      let height = 2 + 8;
      for (const item of node.children) {
        height += Math.max(22, sumBlockChildren(item.children, bodyWidth));
      }
      return height;
    }
    case "code": {
      const codeHeight = measureCodeBlockHeight(node.value, CODE_STYLE, width - 26).height;
      return 16 + 2 + 26 + 24 + codeHeight;
    }
    case "table": {
      const columnCount = Math.max(1, node.children[0]?.children.length ?? 1);
      const cellWidth = (width - 1) / columnCount - 15;
      let rowsHeight = 0;
      for (const row of node.children) {
        let rowHeight = 0;
        for (const cell of row.children) {
          rowHeight = Math.max(
            rowHeight,
            measurePlainText(plainRichMarkdownRootText(cell), TABLE_STYLE, cellWidth) + 15,
          );
        }
        rowsHeight += rowHeight;
      }
      return 14 + 1 + rowsHeight;
    }
    case "thematicBreak":
      return 25;
    case "html":
    case "yaml":
      return measurePlainText(node.value, PARAGRAPH_STYLE, width) + 8;
    default:
      return measurePlainText(plainRichMarkdownRootText(node), PARAGRAPH_STYLE, width) + 8;
  }
}

function sumBlockChildren(children: readonly RootContent[], width: number): number {
  let height = 0;
  for (const child of children) {
    height += measureBlockNode(child, width);
  }
  return height;
}

function measureInline(
  children: readonly PhrasingContent[],
  baseStyle: TextStyle,
  width: number,
): number {
  const items: InlineFlowItem[] = [];
  appendInlineItems(items, children, baseStyle);
  return measureInlineFlow(prepareInlineFlow(items), width, baseStyle.lineHeight ?? 0).height;
}

function appendInlineItems(
  items: InlineFlowItem[],
  children: readonly PhrasingContent[],
  inheritedStyle: TextStyle,
): void {
  for (const child of children) {
    switch (child.type) {
      case "text":
        items.push({ style: inheritedStyle, text: child.value });
        break;
      case "inlineCode":
        items.push({ style: CODE_STYLE, text: child.value });
        break;
      case "strong":
        appendInlineItems(items, child.children, { ...inheritedStyle, fontWeight: "700" });
        break;
      case "emphasis":
        appendInlineItems(items, child.children, { ...inheritedStyle, fontStyle: "italic" });
        break;
      case "delete":
      case "link":
      case "linkReference":
        appendInlineItems(items, child.children, inheritedStyle);
        break;
      case "break":
        items.push({ style: inheritedStyle, text: "\n" });
        break;
      case "image":
      case "imageReference":
        items.push({ style: inheritedStyle, text: child.alt ?? "Image" });
        break;
      case "footnoteReference":
        items.push({ style: inheritedStyle, text: `[${child.identifier}]` });
        break;
      case "html":
        items.push({ style: inheritedStyle, text: child.value });
        break;
    }
  }
}

function measurePlainText(text: string, style: TextStyle, width: number): number {
  return layout(prepare(text, style), width, style.lineHeight).height;
}
