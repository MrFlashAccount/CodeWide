import type { List, ListItem } from "mdast";

import type { MarkdownDocumentBlock } from "./markdown-document-blocks";

const MIN_GROUPED_ITEMS = 8;
const ITEMS_PER_GROUP = 3;
const MAX_GROUP_LINES = 24;
const MAX_GROUP_CHARS = 2400;
const MAX_NESTING = 4;
const MAX_ITEM_BLOCKS = 2;

/** A single selectable paragraph. Paths match the original unsliced Markdown AST. */
export type MarkdownListLine = Readonly<{
  body: string;
  depth: number;
  followedByChildren: boolean;
  marker: string;
  path: string;
}>;

/** Only completed chat blocks can carry a bounded native text layout. */
export type ChatMarkdownBlock = MarkdownDocumentBlock & {
  readonly listGroup?: {
    readonly firstItem: number;
    readonly lines: readonly MarkdownListLine[];
  };
};

type Level = Readonly<{ depth: number; list: List; path: string }>;

function plainParagraph(item: ListItem): string | null {
  if (item.children.length > MAX_ITEM_BLOCKS) {
    return null;
  }
  const paragraph = item.children[0];
  if (paragraph?.type !== "paragraph" || paragraph.children.length !== 1) {
    return null;
  }
  const text = paragraph.children[0];
  if (text?.type !== "text" || text.value.includes("\n")) {
    return null;
  }
  return text.value;
}

function listMarker(item: ListItem, list: List, index: number): string {
  if (typeof item.checked === "boolean") {
    return item.checked ? "checked" : "unchecked";
  }
  return list.ordered === true ? `${String((list.start ?? 1) + index)}.` : "•";
}

function appendItem(lines: MarkdownListLine[], level: Level, index: number): boolean {
  const item = level.list.children[index];
  if (item === undefined || lines.length >= MAX_GROUP_LINES || level.depth > MAX_NESTING) {
    return false;
  }
  const body = plainParagraph(item);
  const nested = item.children[1];
  if (body === null || (nested !== undefined && nested.type !== "list")) {
    return false;
  }
  const path = `${level.path}/item-${String(index)}`;
  lines.push({
    body,
    depth: level.depth,
    followedByChildren: nested !== undefined,
    marker: listMarker(item, level.list, index),
    path: `${path}-0`,
  });
  if (nested === undefined) {
    return true;
  }
  const childLevel = { depth: level.depth + 1, list: nested, path: `${path}-1` };
  return nested.children.every((_, child) => appendItem(lines, childLevel, child));
}

function makeGroup(
  block: MarkdownDocumentBlock,
  level: Level,
  first: number,
): ChatMarkdownBlock | null {
  const lines: MarkdownListLine[] = [];
  const list = level.list;
  const end = Math.min(first + ITEMS_PER_GROUP, list.children.length);
  for (let index = first; index < end; index++) {
    if (!appendItem(lines, level, index)) {
      return null;
    }
  }
  if (lines.reduce((sum, line) => sum + line.body.length, 0) > MAX_GROUP_CHARS) {
    return null;
  }
  return {
    ...block,
    key: `${block.key}/part-${String(first)}`,
    listGroup: { firstItem: first, lines },
    node: {
      ...list,
      children: list.children.slice(first, end),
      start: list.ordered === true ? (list.start ?? 1) + first : list.start,
    },
  };
}

/** Splits eligible lists into viewport items. Rich or oversized items keep their original renderer. */
export function groupChatMarkdownList(block: MarkdownDocumentBlock): ChatMarkdownBlock[] | null {
  const list = block.node;
  if (list.type !== "list" || list.children.length < MIN_GROUPED_ITEMS) {
    return null;
  }
  const level = { depth: 0, list, path: `${block.reviewPathPrefix}/${block.path}` };
  const groups: ChatMarkdownBlock[] = [];
  for (let first = 0; first < list.children.length; first += ITEMS_PER_GROUP) {
    const group = makeGroup(block, level, first);
    if (group === null) {
      return null;
    }
    groups.push(group);
  }
  return groups;
}
