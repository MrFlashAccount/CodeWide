import { parseRichMarkdown, richMarkdownBlockIndexAtLine } from "@codewide/rendering-core";
import type { RootContent } from "mdast";

import type { MarkdownLineTarget } from "./document-preview";
import { collectMarkdownImageOrder } from "./markdown-image-order";

/** A viewport item retains the original AST node and persisted review address. */
export type MarkdownDocumentBlock = {
  key: string;
  node: RootContent;
  path: string;
  reviewPathPrefix: string;
  imageOrder: WeakMap<object, number>;
  segmentIndex: number;
  blockIndex: number;
};

/** Parser segments bound parsing; individual Markdown blocks bound mounting. */
export function markdownDocumentBlocks(segments: readonly string[]): MarkdownDocumentBlock[] {
  const blocks: MarkdownDocumentBlock[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const parsed = parseRichMarkdown(segments[segmentIndex]!);
    const imageOrder = collectMarkdownImageOrder(parsed.root);
    const reviewPathPrefix = `segment-${segmentIndex}`;
    for (let blockIndex = 0; blockIndex < parsed.root.children.length; blockIndex += 1) {
      const node = parsed.root.children[blockIndex]!;
      const path = `${node.type}-${blockIndex}`;
      blocks.push({ key: `${reviewPathPrefix}/${path}`, node, path, reviewPathPrefix, imageOrder, segmentIndex, blockIndex });
    }
  }
  return blocks;
}

/** Resolves source-line navigation before the destination viewport is mounted. */
export function markdownDocumentTargetIndex(
  blocks: readonly MarkdownDocumentBlock[],
  segments: readonly string[],
  target: MarkdownLineTarget | null,
): number {
  if (target === null) return 0;
  const source = segments[target.segmentIndex];
  if (source === undefined) return 0;
  const blockIndex = richMarkdownBlockIndexAtLine(source, target.line);
  const index = blocks.findIndex((block) => block.segmentIndex === target.segmentIndex && block.blockIndex === blockIndex);
  return Math.max(0, index);
}
