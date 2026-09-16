export type ContentReviewTarget = {
  id: string;
  label: string;
  reference: string | null;
};

type TextReviewAnchor = {
  blockPath: string;
  end: number;
  kind: "text";
  quote: string;
  start: number;
  target: ContentReviewTarget;
};

type MermaidReviewAnchor = {
  diagramId: string;
  kind: "mermaid";
  source: string;
  target: ContentReviewTarget;
  x: number;
  y: number;
};

type ResponseReviewAnchor = {
  kind: "response";
  target: ContentReviewTarget;
};

type ImageReviewAnchor = {
  kind: "image";
  target: ContentReviewTarget;
  x: number;
  y: number;
};

export type ContentReviewAnchor =
  | TextReviewAnchor
  | MermaidReviewAnchor
  | ResponseReviewAnchor
  | ImageReviewAnchor;

export type ContentReviewComment = {
  anchor: ContentReviewAnchor;
  body: string;
  createdAt: number;
  id: string;
};

export function contentReviewTextHighlights(
  anchors: readonly ContentReviewAnchor[],
  targetId: string,
  blockPath: string,
  offset = 0,
): Array<{ end: number; start: number }> {
  return anchors.flatMap((anchor) => {
    if (anchor.kind !== "text" || anchor.target.id !== targetId || anchor.blockPath !== blockPath) {
      return [];
    }
    const start = Math.max(0, anchor.start - offset);
    const end = Math.max(0, anchor.end - offset);
    return end > start ? [{ end, start }] : [];
  });
}

export function normalizedReviewPoint(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function serializeContentReviewAttachment(
  comments: readonly ContentReviewComment[],
): string {
  const populated = comments.filter((comment) => comment.body.trim() !== "");
  if (populated.length === 0) {
    return "";
  }
  const targetIds = new Set(populated.map((comment) => comment.anchor.target.id));
  const lines = [
    "---",
    "kind: codewide-content-review",
    "version: 1",
    `targets: ${String(targetIds.size)}`,
    `comments: ${String(populated.length)}`,
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
      const label = anchor.target.label.trim();
      lines.push(`## ${escapeHeading(label === "" ? "Reviewed content" : label)}`, "");
      if (anchor.target.reference !== null && anchor.target.reference.trim() !== "") {
        lines.push(`Reference: \`${escapeInlineCode(anchor.target.reference)}\``, "");
      }
      previousTargetId = anchor.target.id;
    }
    const ordinal = lines.filter((line) => line.startsWith("### Comment ")).length + 1;
    if (anchor.kind === "text") {
      lines.push(`### Comment ${String(ordinal)} · selected text`, "");
      lines.push(
        `Block: \`${escapeInlineCode(anchor.blockPath)}\` · rendered offsets ${String(anchor.start)}–${String(anchor.end)}`,
        "",
      );
      lines.push(...quoteMarkdown(anchor.quote), "");
      lines.push(comment.body.trim(), "");
      return;
    }
    if (anchor.kind === "response") {
      lines.push(`### Comment ${String(ordinal)} · whole response`, "");
      lines.push("Scope: **entire response**", "");
      lines.push(comment.body.trim(), "");
      return;
    }
    if (anchor.kind === "image") {
      lines.push(`### Comment ${String(ordinal)} · image point`, "");
      lines.push(
        `Point: **(${formatPercent(anchor.x)}, ${formatPercent(anchor.y)})** from the image top-left.`,
        "",
      );
      lines.push(comment.body.trim(), "");
      return;
    }
    const diagramKey = `${anchor.target.id}\u0000${anchor.diagramId}`;
    lines.push(`### Comment ${String(ordinal)} · Mermaid point`, "");
    lines.push(`Diagram: \`${escapeInlineCode(anchor.diagramId)}\``, "");
    lines.push(
      `Point: **(${formatPercent(anchor.x)}, ${formatPercent(anchor.y)})** from the SVG top-left.`,
      "",
    );
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
  const longest = [...value.matchAll(/`+/gu)].reduce(
    (length, match) => Math.max(length, match[0].length),
    0,
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function escapeHeading(value: string): string {
  return value.replaceAll("\n", " ").replace(/^#+\s*/u, "");
}

function escapeInlineCode(value: string): string {
  return value.replaceAll("`", "\\`").replaceAll("\n", " ");
}
