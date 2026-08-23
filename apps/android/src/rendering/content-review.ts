export type ContentReviewTarget = {
  id: string;
  label: string;
  reference: string | null;
};

export type TextReviewAnchor = {
  kind: "text";
  target: ContentReviewTarget;
  blockPath: string;
  quote: string;
  start: number;
  end: number;
};

export type MermaidReviewAnchor = {
  kind: "mermaid";
  target: ContentReviewTarget;
  diagramId: string;
  source: string;
  x: number;
  y: number;
};

export type ContentReviewAnchor = TextReviewAnchor | MermaidReviewAnchor;

export type ContentReviewComment = {
  id: string;
  anchor: ContentReviewAnchor;
  body: string;
  createdAt: number;
};

export function contentReviewTextHighlights(
  anchors: readonly ContentReviewAnchor[],
  targetId: string,
  blockPath: string,
  offset = 0,
): Array<{ start: number; end: number }> {
  return anchors.flatMap((anchor) => {
    if (anchor.kind !== "text" || anchor.target.id !== targetId || anchor.blockPath !== blockPath) return [];
    const start = Math.max(0, anchor.start - offset);
    const end = Math.max(0, anchor.end - offset);
    return end > start ? [{ start, end }] : [];
  });
}

export function normalizedReviewPoint(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function serializeContentReviewAttachment(comments: readonly ContentReviewComment[]): string {
  const populated = comments.filter((comment) => comment.body.trim() !== "");
  if (populated.length === 0) return "";
  const targetIds = new Set(populated.map((comment) => comment.anchor.target.id));
  const lines = [
    "---",
    "kind: codewide-content-review",
    "version: 1",
    `targets: ${targetIds.size}`,
    `comments: ${populated.length}`,
    "---",
    "",
    "# Content review comments",
    "",
  ];
  let previousTargetId: string | null = null;
  const emittedDiagrams = new Set<string>();
  populated.forEach((comment) => {
    const { anchor } = comment;
    if (anchor.target.id !== previousTargetId) {
      lines.push(`## ${escapeHeading(anchor.target.label.trim() || "Reviewed content")}`, "");
      if (anchor.target.reference !== null && anchor.target.reference.trim() !== "") {
        lines.push(`Reference: \`${escapeInlineCode(anchor.target.reference)}\``, "");
      }
      previousTargetId = anchor.target.id;
    }
    const ordinal = lines.filter((line) => /^### Comment /u.test(line)).length + 1;
    if (anchor.kind === "text") {
      lines.push(`### Comment ${ordinal} · selected text`, "");
      lines.push(`Block: \`${escapeInlineCode(anchor.blockPath)}\` · rendered offsets ${anchor.start}–${anchor.end}`, "");
      lines.push(...quoteMarkdown(anchor.quote), "");
      lines.push(comment.body.trim(), "");
      return;
    }
    const diagramKey = `${anchor.target.id}\u0000${anchor.diagramId}`;
    lines.push(`### Comment ${ordinal} · Mermaid point`, "");
    lines.push(`Diagram: \`${escapeInlineCode(anchor.diagramId)}\``, "");
    lines.push(`Point: **(${formatPercent(anchor.x)}, ${formatPercent(anchor.y)})** from the SVG top-left.`, "");
    if (!emittedDiagrams.has(diagramKey)) {
      emittedDiagrams.add(diagramKey);
      const fence = markdownFence(anchor.source);
      lines.push(`${fence}mermaid`, anchor.source.trimEnd(), fence, "");
    }
    lines.push(comment.body.trim(), "");
  });
  return `${lines.join("\n").trimEnd()}\n`;
}

function quoteMarkdown(value: string): string[] {
  const normalized = value.trim().replaceAll("\r\n", "\n");
  return (normalized === "" ? [""] : normalized.split("\n")).map((line) => `> ${line}`.trimEnd());
}

function formatPercent(value: number): string {
  return `${(normalizedReviewPoint(value) * 100).toFixed(1)}%`;
}

function markdownFence(value: string): string {
  const longest = [...value.matchAll(/`+/gu)].reduce((length, match) => Math.max(length, match[0].length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function escapeHeading(value: string): string {
  return value.replaceAll("\n", " ").replace(/^#+\s*/u, "");
}

function escapeInlineCode(value: string): string {
  return value.replaceAll("`", "\\`").replaceAll("\n", " ");
}
