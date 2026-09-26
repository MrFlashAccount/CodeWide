import { processFile, type FileDiffMetadata } from "@pierre/diffs";

import type { CodeReviewDocument } from "../editorBridge";
import { canonicalPatch } from "./canonicalPatch.web";

/** Reconstructs the pre-edit file from ordered recorded patches and today's file. */
export function materializeBeforeSource(payload: CodeReviewDocument): string | null {
  if (hasEmptyScopeBaseline(payload)) {
    return "";
  }
  const lines = payload.source.split("\n");
  try {
    for (let patchIndex = payload.patches.length - 1; patchIndex >= 0; patchIndex -= 1) {
      const patch = payload.patches.at(patchIndex);
      if (patch === undefined || patch.diff === "") {
        continue;
      }
      const metadata = processFile(canonicalPatch(payload.path, patch), {
        cacheKey: `${payload.revision}:patch:${String(patchIndex)}`,
        throwOnError: true,
      });
      if (metadata === undefined || !reversePatch(lines, metadata, payload.fullFileDiff === true)) {
        return null;
      }
    }
    return lines.join("\n");
  } catch {
    return null;
  }
}

function hasEmptyScopeBaseline(payload: CodeReviewDocument): boolean {
  // The first recorded add establishes an empty baseline for a complete-file scope.
  // Later file writes may be absent from recorded patches, but cannot change that baseline.
  return payload.fullFileDiff === true && payload.patches[0]?.kind === "add";
}

function reversePatch(
  lines: string[],
  metadata: FileDiffMetadata,
  allowRelocation: boolean,
): boolean {
  for (let hunkIndex = metadata.hunks.length - 1; hunkIndex >= 0; hunkIndex -= 1) {
    const hunk = metadata.hunks.at(hunkIndex);
    if (hunk === undefined) {
      continue;
    }
    const expectedStart = Math.max(0, hunk.additionStart - 1);
    const after = metadata.additionLines
      .slice(hunk.additionLineIndex, hunk.additionLineIndex + hunk.additionCount)
      .map(stripLineEnding);
    const before = metadata.deletionLines
      .slice(hunk.deletionLineIndex, hunk.deletionLineIndex + hunk.deletionCount)
      .map(stripLineEnding);
    const start = locateHunk({ after, allowRelocation, expectedStart, lines });
    if (start === null) {
      return false;
    }
    lines.splice(start, after.length, ...before);
  }
  return true;
}

function locateHunk({
  after,
  allowRelocation,
  expectedStart,
  lines,
}: {
  after: readonly string[];
  allowRelocation: boolean;
  expectedStart: number;
  lines: readonly string[];
}): number | null {
  if (sameLines(lines, expectedStart, after)) {
    return expectedStart;
  }
  // A later edit can shift unchanged hunk context. Relocate only a unique
  // match; repeated text does not provide enough evidence for a net diff.
  if (!allowRelocation || after.length === 0) {
    return null;
  }
  let match: number | null = null;
  for (let start = 0; start <= lines.length - after.length; start += 1) {
    if (!sameLines(lines, start, after)) {
      continue;
    }
    if (match !== null) {
      return null;
    }
    match = start;
  }
  return match;
}

function sameLines(lines: readonly string[], start: number, expected: readonly string[]): boolean {
  return expected.every((line, offset) => lines[start + offset] === line);
}

function stripLineEnding(value: string): string {
  return value.replace(/\r?\n$/, "");
}
