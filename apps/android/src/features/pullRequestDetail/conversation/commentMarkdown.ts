/** Character offsets reported by the native text editor, in UTF-16 code units. */
export type CommentSelection = { readonly end: number; readonly start: number };

const spans = { bold: "**", italic: "_", strike: "~~" } as const;
const lines = {
  bullet: "- ",
  heading: "### ",
  number: "1. ",
  quote: "> ",
  task: "- [ ] ",
} as const;

/** Commands insert ordinary Markdown, preserving source the editor did not touch. */
export type CommentFormat =
  | keyof typeof spans
  | keyof typeof lines
  | "code"
  | "block"
  | "link"
  | "image";

/** A text replacement and where continued typing belongs after applying it. */
export type CommentEdit = { readonly selection: CommentSelection; readonly text: string };

function ticks(text: string): string {
  let count = 0;
  for (const match of text.matchAll(/`+/gu)) {
    count = Math.max(count, match[0].length);
  }
  return "`".repeat(count + 1);
}

/** Inserts a link to a forge-hosted attachment using the original filename as its label. */
export function attachmentMarkdown(name: string, url: string, image: boolean): string {
  const label = name.replaceAll(/[\\[\]]/gu, String.raw`\$&`).replaceAll(/[\r\n]/gu, " ");
  const target = url
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll(/[\s<>]/gu, encodeURIComponent);
  return `${image ? "!" : ""}[${label}](${target})`;
}

/** Applies one toolbar action to the selection or to its complete lines. */
export function formatComment(
  text: string,
  range: CommentSelection,
  format: CommentFormat,
): CommentEdit {
  const start = Math.max(0, Math.min(range.start, text.length));
  const end = Math.max(start, Math.min(range.end, text.length));
  const selected = text.slice(start, end);
  const replace = (before: string, content: string, after: string): CommentEdit => ({
    selection: { end: start + before.length + content.length, start: start + before.length },
    text: text.slice(0, start) + before + content + after + text.slice(end),
  });
  if (format === "bold" || format === "italic" || format === "strike") {
    return replace(spans[format], selected, spans[format]);
  }
  if (format === "code" || format === "block") {
    return codeEdit({ end, selected, start, text }, format, replace);
  }
  if (format === "link" || format === "image") {
    return linkEdit(selected, format, replace);
  }
  return lineEdit(text, { end, start }, lines[format]);
}
function linkEdit(selected: string, format: "link" | "image", replace: Replace): CommentEdit {
  const label = selected.length === 0 ? (format === "image" ? "Image" : "Link") : selected;
  const prefix = format === "image" ? "!" : "";
  return replace(
    prefix + "[" + label.replaceAll(/[\\[\]]/gu, String.raw`\$&`) + "](",
    "https://",
    ")",
  );
}

type Replace = (before: string, selected: string, after: string) => CommentEdit;

function codeEdit(
  {
    end,
    selected,
    start,
    text,
  }: CommentSelection & { readonly selected: string; readonly text: string },
  format: "code" | "block",
  replace: Replace,
): CommentEdit {
  if (format === "code") {
    const fence = ticks(selected);
    const gap = selected.startsWith("`") || selected.endsWith("`") ? " " : "";
    return replace(fence + gap, selected, gap + fence);
  }
  {
    const fence = ticks(selected).padEnd("```".length, "`");
    const before = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
    const after = end < text.length && text[end] !== "\n" ? "\n" : "";
    return replace(before + fence + "\n", selected, "\n" + fence + after);
  }
}
function lineEdit(text: string, { end, start }: CommentSelection, leading: string): CommentEdit {
  const lineStart = text.slice(0, start).lastIndexOf("\n") + 1;
  const portion = text.slice(lineStart, end);
  const pieces = portion.split("\n");
  if (pieces.length > 1 && pieces.at(-1) === "") {
    pieces.pop();
  }
  const marked = pieces.map((line) => leading + line).join("\n");
  const trailing = portion.endsWith("\n") ? "\n" : "";
  const value = text.slice(0, lineStart) + marked + trailing + text.slice(end);
  const next = end + value.length - text.length;
  return {
    selection: { end: next, start: start === end ? next : start + leading.length },
    text: value,
  };
}
