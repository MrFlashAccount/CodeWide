import type { V2ThreadChangePatch } from "@codewide/sync-client/v2";

import {
  reviewFileTarget,
  type ReviewDiffLine,
  type ReviewLineAnchor,
  type ReviewSplitLine,
} from "./reviewModel";

interface HunkPosition {
  newLine: number;
  oldLine: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

export function reviewDiffLines(path: string, patches: V2ThreadChangePatch[]): ReviewDiffLine[] {
  const result: ReviewDiffLine[] = [];
  for (const patch of patches) appendPatchLines(result, path, patch.diff);
  return result;
}

export function reviewSplitLines(lines: ReviewDiffLine[]): ReviewSplitLine[] {
  const result: ReviewSplitLine[] = [];
  let pendingDeleted: ReviewDiffLine[] = [];
  let pendingAdded: ReviewDiffLine[] = [];
  const flushChanges = (): void => {
    const count = Math.max(pendingDeleted.length, pendingAdded.length);
    for (let index = 0; index < count; index += 1) {
      result.push({
        key: `change:${result.length}`,
        left: pendingDeleted[index] ?? null,
        right: pendingAdded[index] ?? null,
      });
    }
    pendingDeleted = [];
    pendingAdded = [];
  };
  for (const line of lines) {
    if (line.kind === "deleted") {
      pendingDeleted.push(line);
      continue;
    }
    if (line.kind === "added") {
      pendingAdded.push(line);
      continue;
    }
    flushChanges();
    result.push({ key: `${line.kind}:${result.length}`, left: line, right: line });
  }
  flushChanges();
  return result;
}

export function reviewSourceLines(path: string, source: string): ReviewDiffLine[] {
  const target = reviewFileTarget(path);
  return logicalLines(source).map((text, index) => {
    const line = index + 1;
    return diffLine("context", text, line, line, anchor(target, path, line, "new", ` ${text}`));
  });
}

function appendPatchLines(result: ReviewDiffLine[], path: string, diff: string): void {
  const target = reviewFileTarget(path);
  let position: HunkPosition | null = null;
  for (const text of logicalLines(diff)) {
    const hunk = HUNK_HEADER.exec(text);
    if (hunk !== null) {
      position = { newLine: Number(hunk[2]), oldLine: Number(hunk[1]) };
      result.push(diffLine("header", text, null, null, null));
      continue;
    }
    if (position === null || isFileHeader(text)) {
      result.push(diffLine("header", text, null, null, null));
      continue;
    }
    if (text.startsWith("+")) {
      const line = position.newLine;
      result.push(
        diffLine("added", text.slice(1), null, line, anchor(target, path, line, "new", text)),
      );
      position.newLine += 1;
      continue;
    }
    if (text.startsWith("-")) {
      const line = position.oldLine;
      result.push(
        diffLine("deleted", text.slice(1), line, null, anchor(target, path, line, "old", text)),
      );
      position.oldLine += 1;
      continue;
    }
    const content = text.startsWith(" ") ? text.slice(1) : text;
    result.push(
      diffLine(
        "context",
        content,
        position.oldLine,
        position.newLine,
        anchor(target, path, position.newLine, "new", text),
      ),
    );
    position.oldLine += 1;
    position.newLine += 1;
  }
}

function logicalLines(value: string): string[] {
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function anchor(
  target: ReturnType<typeof reviewFileTarget>,
  path: string,
  line: number,
  side: "new" | "old",
  context: string,
): ReviewLineAnchor {
  return { context: context.slice(1), kind: "line", line, path, side, target };
}

function diffLine(
  kind: ReviewDiffLine["kind"],
  text: string,
  oldLine: number | null,
  newLine: number | null,
  anchorValue: ReviewLineAnchor | null,
): ReviewDiffLine {
  return { anchor: anchorValue, kind, newLine, oldLine, text };
}

function isFileHeader(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith(String.raw`\ No newline`)
  );
}
