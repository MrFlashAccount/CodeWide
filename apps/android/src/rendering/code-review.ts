export type CodeReviewLineSide = "new" | "old";

export type CodeReviewLineReference = {
  path: string;
  line: number;
  column?: number;
  side: CodeReviewLineSide;
  coordinate?: "file" | "diff";
  context?: string;
};

export type CodeReviewComment = CodeReviewLineReference & {
  id: string;
  body: string;
  createdAt: number;
};

export function codeReviewCommentKey(reference: CodeReviewLineReference): string {
  return `${reference.path}\u0000${reference.coordinate ?? "file"}\u0000${reference.side}\u0000${reference.line}`;
}

export function serializeCodeReviewAttachment(comments: readonly CodeReviewComment[]): string {
  const ordered = [...comments].sort((left, right) => (
    left.path.localeCompare(right.path)
    || left.line - right.line
    || left.createdAt - right.createdAt
  ));
  const lines = [
    "---",
    "kind: codewide-code-review",
    "version: 1",
    `comments: ${ordered.length}`,
    "---",
    "",
    "# Code review comments",
    "",
  ];
  for (const comment of ordered) {
    lines.push(
      `## \`${escapeInlineCode(comment.path)}\` · ${comment.coordinate === "diff" ? "diff" : comment.side === "old" ? "old line" : "line"} ${comment.line}`,
      "",
      ...(comment.context === undefined ? [] : [`> \`${escapeInlineCode(comment.context)}\``, ""]),
      comment.body.trim(),
      "",
    );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function escapeInlineCode(value: string): string {
  return value.replaceAll("`", "\\`");
}
