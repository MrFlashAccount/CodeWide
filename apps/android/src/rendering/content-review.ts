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

type VideoReviewAnchor = {
  kind: "video";
  target: ContentReviewTarget;
  timeSeconds: number;
  x: number;
  y: number;
};

export type ContentReviewAnchor =
  | TextReviewAnchor
  | MermaidReviewAnchor
  | ResponseReviewAnchor
  | ImageReviewAnchor
  | VideoReviewAnchor;

export type ContentReviewComment = {
  anchor: ContentReviewAnchor;
  body: string;
  createdAt: number;
  id: string;
};

type VisualReviewAnchor = Extract<ContentReviewAnchor, { kind: "image" | "video" }>;

const MILLISECONDS_PER_SECOND = 1000;
const MILLISECONDS_PER_MINUTE = 60_000;
const MILLISECONDS_PER_HOUR = 3_600_000;
const CLOCK_DIGIT_WIDTH = 2;
const MILLISECOND_DIGIT_WIDTH = 3;

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
    if (isVisualReviewAnchor(anchor)) {
      appendVisualReview(lines, { anchor, body: comment.body, ordinal });
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

function formatVideoTime(value: number): string {
  const totalMilliseconds = Math.max(0, Math.round(value * MILLISECONDS_PER_SECOND));
  const hours = Math.floor(totalMilliseconds / MILLISECONDS_PER_HOUR);
  const minutes = Math.floor((totalMilliseconds % MILLISECONDS_PER_HOUR) / MILLISECONDS_PER_MINUTE);
  const seconds = Math.floor(
    (totalMilliseconds % MILLISECONDS_PER_MINUTE) / MILLISECONDS_PER_SECOND,
  );
  const milliseconds = totalMilliseconds % MILLISECONDS_PER_SECOND;
  const clock = `${String(minutes).padStart(CLOCK_DIGIT_WIDTH, "0")}:${String(seconds).padStart(CLOCK_DIGIT_WIDTH, "0")}.${String(milliseconds).padStart(MILLISECOND_DIGIT_WIDTH, "0")}`;
  return hours === 0 ? clock : `${String(hours)}:${clock}`;
}

function isVisualReviewAnchor(anchor: ContentReviewAnchor): anchor is VisualReviewAnchor {
  return anchor.kind === "image" || anchor.kind === "video";
}

function appendVisualReview(
  lines: string[],
  {
    anchor,
    body,
    ordinal,
  }: { readonly anchor: VisualReviewAnchor; readonly body: string; readonly ordinal: number },
): void {
  lines.push(
    `### Comment ${String(ordinal)} · ${anchor.kind === "image" ? "image" : "video"} point`,
    "",
  );
  if (anchor.kind === "video") {
    lines.push(`Time: **${formatVideoTime(anchor.timeSeconds)}**`, "");
  }
  lines.push(
    `Point: **(${formatPercent(anchor.x)}, ${formatPercent(anchor.y)})** from the ${anchor.kind} top-left.`,
    "",
    body.trim(),
    "",
  );
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
