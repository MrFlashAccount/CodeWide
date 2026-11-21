import { projectMarkdownStream } from "@codewide/rendering-core";
import {
  markdownSegmentBlocks,
  type MarkdownDocumentBlock,
} from "../../../rendering/markdown-document-blocks";
import {
  DEFAULT_TERMINAL_STYLE,
  projectTerminalText,
  type TerminalRun,
  type TerminalStyle,
} from "../../../rendering/terminalAnsiText";
import type { ContentPresentation } from "../../../services/content/contentRouteSession";

/**
 * One virtualized row of a content document. Rows break only where the text
 * breaks anyway (a line end, a Markdown block), so the list shows one
 * continuous text whatever chunks it was read in.
 */
export type ContentDocumentRow =
  | { readonly key: string; readonly kind: "label"; readonly text: string }
  | { readonly key: string; readonly kind: "text"; readonly text: string }
  | { readonly key: string; readonly kind: "terminal"; readonly runs: readonly TerminalRun[] }
  | { readonly block: MarkdownDocumentBlock; readonly key: string; readonly kind: "markdown" };

/**
 * Where one part's text stands between chunks: the text after its last row
 * boundary, which the next chunk continues, and the counters that keep row
 * keys stable while that text grows into rows.
 */
export type ContentPartCursor = {
  readonly carry: string;
  readonly nextRow: number;
  readonly part: number;
  readonly presentation: ContentPresentation;
  readonly style: TerminalStyle;
};

/** The rows a chunk completes and where the part stands after it. */
export type ContentPartStep = {
  readonly cursor: ContentPartCursor;
  readonly rows: readonly ContentDocumentRow[];
};

/** A text row holds at most this many lines, so one row stays cheap to lay out. */
const MAX_ROW_LINES = 64;

/** A text row holds at most this many characters; only a longer single line breaks inside. */
const MAX_ROW_CHARS = 8192;

/** The last code point a single UTF-16 unit encodes. */
const MAX_BASIC_PLANE_CODE_POINT = 0xff_ff;

/** A part before its first chunk. */
export function startContentPart(
  part: number,
  presentation: ContentPresentation,
): ContentPartCursor {
  return { carry: "", nextRow: 0, part, presentation, style: DEFAULT_TERMINAL_STYLE };
}

/**
 * Appends one chunk of a part. Text after the chunk's last row boundary stays
 * in the cursor until the next chunk completes it; `complete` flushes it.
 */
export function appendContentChunk(
  cursor: ContentPartCursor,
  chunk: string,
  complete: boolean,
): ContentPartStep {
  return cursor.presentation === "markdown"
    ? appendMarkdown(cursor, chunk, complete)
    : appendLines(cursor, chunk, complete);
}

/** The rows the text still waiting for its boundary shows until the next chunk. */
export function pendingContentRows(cursor: ContentPartCursor): readonly ContentDocumentRow[] {
  if (cursor.carry === "") {
    return [];
  }
  if (cursor.presentation === "markdown") {
    return markdownRows(cursor.part, cursor.carry, cursor.nextRow);
  }
  return [lineRow(cursor, cursor.carry, cursor.nextRow).row];
}

/** The heading row of a part in a document of several. */
export function contentLabelRow(part: number, label: string): ContentDocumentRow {
  return { key: `${String(part)}:label`, kind: "label", text: label };
}

function appendMarkdown(
  cursor: ContentPartCursor,
  chunk: string,
  complete: boolean,
): ContentPartStep {
  const projected = projectMarkdownStream(cursor.carry, chunk, complete);
  const rows = projected.segments.flatMap((segment, index) =>
    markdownRows(cursor.part, segment, cursor.nextRow + index),
  );
  return {
    cursor: {
      ...cursor,
      carry: projected.remainder,
      nextRow: cursor.nextRow + projected.segments.length,
    },
    rows,
  };
}

function markdownRows(part: number, segment: string, segmentIndex: number): ContentDocumentRow[] {
  return markdownSegmentBlocks(segment, segmentIndex).map((block) => ({
    block,
    key: `${String(part)}:${block.key}`,
    kind: "markdown" as const,
  }));
}

function appendLines(cursor: ContentPartCursor, chunk: string, complete: boolean): ContentPartStep {
  const split = complete ? completeLines(cursor.carry + chunk) : openLines(cursor.carry + chunk);
  let { carry } = split;
  const groups = split.body === null ? [] : lineGroups(split.body);
  // A single line longer than a row continues in the next row; nothing else
  // breaks inside a line.
  while (carry.length > MAX_ROW_CHARS) {
    const cut = safeCut(carry, MAX_ROW_CHARS);
    groups.push(carry.slice(0, cut));
    carry = carry.slice(cut);
  }
  const rows: ContentDocumentRow[] = [];
  let next: ContentPartCursor = cursor;
  for (const group of groups) {
    const projected = lineRow(next, group, next.nextRow);
    rows.push(projected.row);
    next = { ...next, nextRow: next.nextRow + 1, style: projected.style };
  }
  return { cursor: { ...next, carry }, rows };
}

/** The complete lines of a part still being read, and the line its next chunk continues. */
function openLines(pending: string): { readonly body: string | null; readonly carry: string } {
  const lastBreak = pending.lastIndexOf("\n");
  return lastBreak < 0
    ? { body: null, carry: pending }
    : { body: pending.slice(0, lastBreak), carry: pending.slice(lastBreak + 1) };
}

/**
 * A complete part's lines without the final line feed, which ends its last
 * line rather than starting an empty one; no lines for an empty part.
 */
function completeLines(pending: string): { readonly body: string | null; readonly carry: string } {
  if (pending === "") {
    return { body: null, carry: "" };
  }
  return { body: pending.endsWith("\n") ? pending.slice(0, -1) : pending, carry: "" };
}

function lineRow(
  cursor: ContentPartCursor,
  text: string,
  row: number,
): { readonly row: ContentDocumentRow; readonly style: TerminalStyle } {
  const key = `${String(cursor.part)}:${String(row)}`;
  if (cursor.presentation === "terminal") {
    const projected = projectTerminalText(text, cursor.style);
    return { row: { key, kind: "terminal", runs: projected.runs }, style: projected.endStyle };
  }
  return { row: { key, kind: "text", text }, style: cursor.style };
}

/** Groups complete lines into rows of bounded size; an overlong line is split. */
function lineGroups(body: string): string[] {
  const groups: string[] = [];
  let lines: string[] = [];
  let chars = 0;
  const flush = (): void => {
    if (lines.length > 0) {
      groups.push(lines.join("\n"));
    }
    lines = [];
    chars = 0;
  };
  for (const line of body.split("\n")) {
    let rest = line;
    while (rest.length > MAX_ROW_CHARS) {
      flush();
      const cut = safeCut(rest, MAX_ROW_CHARS);
      groups.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    if (lines.length >= MAX_ROW_LINES || chars + rest.length > MAX_ROW_CHARS) {
      flush();
    }
    lines.push(rest);
    chars += rest.length + 1;
  }
  flush();
  return groups;
}

/** A cut at or before `limit` that never separates a UTF-16 surrogate pair. */
function safeCut(text: string, limit: number): number {
  // A code point above the basic plane starting at the last kept unit is a pair the cut would split.
  return (text.codePointAt(limit - 1) ?? 0) > MAX_BASIC_PLANE_CODE_POINT ? limit - 1 : limit;
}
