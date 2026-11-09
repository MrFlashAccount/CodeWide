import { parseRichMarkdown, richMarkdownBlockIndexAtLine } from "@codewide/rendering-core";
import type { RootContent } from "mdast";

import type { MarkdownLineTarget } from "./document-preview";
import { collectMarkdownImageOrder, type MarkdownImageNode } from "./markdown-image-order";

/** A viewport item retains the original AST node and persisted review address. */
export type MarkdownDocumentBlock = {
  blockIndex: number;
  imageOrder: WeakMap<MarkdownImageNode, number>;
  key: string;
  node: RootContent;
  path: string;
  reviewPathPrefix: string;
  segmentIndex: number;
};

/** Parser segments bound parsing; individual Markdown blocks bound mounting. */
export function markdownDocumentBlocks(segments: readonly string[]): MarkdownDocumentBlock[] {
  return segments.flatMap((segment, segmentIndex) => markdownSegmentBlocks(segment, segmentIndex));
}

/** The viewport items of one parser segment, addressed by its index in the document. */
export function markdownSegmentBlocks(
  segment: string,
  segmentIndex: number,
): MarkdownDocumentBlock[] {
  const parsed = parseRichMarkdown(segment);
  const imageOrder = collectMarkdownImageOrder(parsed.root);
  const reviewPathPrefix = `segment-${String(segmentIndex)}`;
  return parsed.root.children.map((node, blockIndex) => {
    const path = `${node.type}-${String(blockIndex)}`;
    return {
      blockIndex,
      imageOrder,
      key: `${reviewPathPrefix}/${path}`,
      node,
      path,
      reviewPathPrefix,
      segmentIndex,
    };
  });
}

/** Resolves source-line navigation before the destination viewport is mounted. */
export function markdownDocumentTargetIndex(
  blocks: readonly MarkdownDocumentBlock[],
  segments: readonly string[],
  target: MarkdownLineTarget | null,
): number {
  if (target === null) {
    return 0;
  }
  const source = segments[target.segmentIndex];
  if (source === undefined) {
    return 0;
  }
  const blockIndex = richMarkdownBlockIndexAtLine(source, target.line);
  const index = blocks.findIndex(
    (block) => block.segmentIndex === target.segmentIndex && block.blockIndex === blockIndex,
  );
  return Math.max(0, index);
}
