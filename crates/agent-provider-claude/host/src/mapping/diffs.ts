/**
 * File changes of Claude's edit tools as neutral `FileChange`s: from the
 * `tool_use` input while the call runs (and in stored history, which has no
 * structured result), and from the applied `structuredPatch` when the live
 * result carries it. Pure.
 */

import type { FileChange } from "../protocol.js";
import { isRecord, type JsonRecord } from "./frames.js";

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function lines(prefix: "-" | "+", text: string): string {
  if (text.length === 0) {
    return "";
  }
  return `${text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n")}\n`;
}

const replacement = (edit: JsonRecord): string =>
  lines("-", str(edit["old_string"]) ?? "") + lines("+", str(edit["new_string"]) ?? "");

const update = (path: string, diff: string): FileChange => ({
  diff,
  kind: "update",
  movePath: null,
  path,
});

/** Diff body of each edit tool, from its input. */
const INPUT_DIFFS: Readonly<Record<string, (input: JsonRecord) => string>> = {
  MultiEdit: (input) => {
    const edits: readonly unknown[] = Array.isArray(input["edits"]) ? input["edits"] : [];
    return edits.map((edit) => (isRecord(edit) ? replacement(edit) : "")).join("");
  },
  NotebookEdit: (input) => lines("+", str(input["new_source"]) ?? ""),
};

/** The change an edit tool call describes by its input. */
export function inputDiff(name: string, input: JsonRecord): readonly FileChange[] {
  const path = str(input["file_path"]) ?? str(input["notebook_path"]) ?? "";
  if (name === "Write") {
    return [{ diff: str(input["content"]) ?? "", kind: "add", movePath: null, path }];
  }
  const diffOf = Object.hasOwn(INPUT_DIFFS, name) ? INPUT_DIFFS[name] : undefined;
  return [update(path, diffOf === undefined ? replacement(input) : diffOf(input))];
}

interface PatchHunk {
  readonly lines: readonly string[];
  readonly newLines: number;
  readonly newStart: number;
  readonly oldLines: number;
  readonly oldStart: number;
}

const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) ? value : null;

function parseHunk(entry: unknown): PatchHunk | null {
  if (!isRecord(entry)) {
    return null;
  }
  const oldStart = int(entry["oldStart"]);
  const oldLines = int(entry["oldLines"]);
  const newStart = int(entry["newStart"]);
  const newLines = int(entry["newLines"]);
  if (oldStart === null || oldLines === null || newStart === null || newLines === null) {
    return null;
  }
  const hunkLines: readonly unknown[] = Array.isArray(entry["lines"]) ? entry["lines"] : [];
  return {
    lines: hunkLines.filter((line): line is string => typeof line === "string"),
    newLines,
    newStart,
    oldLines,
    oldStart,
  };
}

function parseHunks(value: unknown): readonly PatchHunk[] {
  const entries: readonly unknown[] = Array.isArray(value) ? value : [];
  return entries.flatMap((entry) => {
    const hunk = parseHunk(entry);
    return hunk === null ? [] : [hunk];
  });
}

/** Renders structuredPatch hunks as a unified diff body. */
export function renderHunks(hunks: readonly PatchHunk[]): string {
  return hunks
    .map((hunk) => {
      const header = `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`;
      return `${header}\n${hunk.lines.map((line) => `${line}\n`).join("")}`;
    })
    .join("");
}

/** The unified diff of a structured result's patch, or `null` without hunks. */
function patchDiff(result: JsonRecord, path: string): readonly FileChange[] | null {
  const hunks = parseHunks(result["structuredPatch"]);
  return hunks.length > 0 ? [update(path, renderHunks(hunks))] : null;
}

/** What a `Write` result recorded: a created file, a patch, or the whole replaced content. */
function writtenFile(input: JsonRecord, result: JsonRecord, path: string): readonly FileChange[] {
  if (result["type"] === "create") {
    const content = str(result["content"]) ?? str(input["content"]) ?? "";
    return [{ diff: content, kind: "add", movePath: null, path }];
  }
  const original = str(result["originalFile"]) ?? "";
  return (
    patchDiff(result, path) ?? [
      update(path, lines("-", original) + lines("+", str(result["content"]) ?? "")),
    ]
  );
}

/** The change recorded in a structured edit result, or `null` when it has none. */
function structuredDiff(
  name: string,
  input: JsonRecord,
  result: JsonRecord,
): readonly FileChange[] | null {
  const path = str(result["filePath"]) ?? inputDiff(name, input)[0]?.path ?? "";
  return name === "Write" ? writtenFile(input, result, path) : patchDiff(result, path);
}

/** The change an edit tool call applied, preferring its structured result. */
export function completedDiff(
  name: string,
  input: JsonRecord,
  toolUseResult: unknown,
): readonly FileChange[] {
  const fallback = inputDiff(name, input);
  if (!isRecord(toolUseResult)) {
    return fallback;
  }
  const path = str(toolUseResult["filePath"]);
  return (
    structuredDiff(name, input, toolUseResult) ??
    fallback.map((change) => ({ ...change, path: path ?? change.path }))
  );
}
