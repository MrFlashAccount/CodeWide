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
  const blocks: MarkdownDocumentBlock[] = [];
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    const segment = segments[segmentIndex];
    if (segment === undefined) {
      continue;
    }
    const parsed = parseRichMarkdown(segment);
    const imageOrder = collectMarkdownImageOrder(parsed.root);
    const reviewPathPrefix = `segment-${String(segmentIndex)}`;
    for (let blockIndex = 0; blockIndex < parsed.root.children.length; blockIndex += 1) {
      const node = parsed.root.children[blockIndex];
      if (node === undefined) {
        continue;
      }
      const path = `${node.type}-${String(blockIndex)}`;
      blocks.push({
        blockIndex,
        imageOrder,
        key: `${reviewPathPrefix}/${path}`,
        node,
        path,
        reviewPathPrefix,
        segmentIndex,
      });
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
