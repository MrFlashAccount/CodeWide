import type { ReviewComment } from "./reviewModel";

/** Serializes review feedback without duplicating the reviewed response or source document. */
export function serializeReviewFeedback(comments: ReviewComment[]): string {
  const populated = comments.filter((comment) => comment.body.trim() !== "");
  if (populated.length === 0) return "";
  populated.sort(compareComments);
  const lines = [
    "---",
    "kind: codewide-review-feedback",
    "version: 2",
    `comments: ${populated.length}`,
    "---",
    "",
    "# Review feedback",
    "",
  ];
  for (const comment of populated) appendComment(lines, comment);
  return `${lines.join("\n").trimEnd()}\n`;
}

function appendComment(lines: string[], comment: ReviewComment): void {
  const { anchor } = comment;
  if (anchor.kind === "line") {
    lines.push(
      `## \`${escapeInlineCode(anchor.path)}\` · ${anchor.side} line ${anchor.line}`,
      "",
      `> \`${escapeInlineCode(anchor.context)}\``,
      "",
      comment.body.trim(),
      "",
    );
    return;
  }
  if (anchor.kind === "text") {
    lines.push(
      `## ${escapeHeading(anchor.target.label)} · selected text`,
      "",
      `Block: \`${escapeInlineCode(anchor.blockPath)}\` · rendered offsets ${anchor.start}–${anchor.end}`,
      "",
      ...quoteMarkdown(anchor.quote),
      "",
      comment.body.trim(),
      "",
    );
    return;
  }
  if (anchor.kind === "diagram") {
    lines.push(
      `## ${escapeHeading(anchor.target.label)} · diagram point`,
      "",
      `Diagram: \`${escapeInlineCode(anchor.diagramId)}\` · normalized point ${anchor.x.toFixed(4)}, ${anchor.y.toFixed(4)}`,
      "",
      ...quoteMarkdown(anchor.source),
      "",
      comment.body.trim(),
      "",
    );
    return;
  }
  lines.push(
    `## ${escapeHeading(anchor.target.label)} · whole response`,
    "",
    ...(anchor.target.reference === null
      ? []
      : [`Reference: \`${escapeInlineCode(anchor.target.reference)}\``, ""]),
    comment.body.trim(),
    "",
  );
}

function compareComments(left: ReviewComment, right: ReviewComment): number {
  const target = left.anchor.target.id.localeCompare(right.anchor.target.id);
  if (target !== 0) return target;
  if (left.anchor.kind === "line" && right.anchor.kind === "line") {
    const path = left.anchor.path.localeCompare(right.anchor.path);
    if (path !== 0) return path;
    const line = left.anchor.line - right.anchor.line;
    if (line !== 0) return line;
  }
  return left.order - right.order;
}

function quoteMarkdown(value: string): string[] {
  const normalized = value.trim().replaceAll("\r\n", "\n");
  return (normalized === "" ? [""] : normalized.split("\n")).map((line) => `> ${line}`.trimEnd());
}

function escapeHeading(value: string): string {
  const heading = value
    .trim()
    .replaceAll("\n", " ")
    .replace(/^#+\s*/u, "");
  return heading === "" ? "Reviewed content" : heading;
}

function escapeInlineCode(value: string): string {
  return value.replaceAll("`", "\\`").replaceAll("\n", " ");
}
