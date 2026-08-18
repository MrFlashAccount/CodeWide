export type FileChangeKind = "add" | "delete" | "update";

export type FileChangeProjection = {
  kind: FileChangeKind;
  lines: string[];
  renderSource: string;
  additions: number;
  deletions: number;
};

export function normalizeFileChangeKind(value: unknown): FileChangeKind {
  const candidate = typeof value === "string"
    ? value
    : isRecord(value) && typeof value.type === "string" ? value.type : "update";
  if (candidate === "add" || candidate === "delete") return candidate;
  return "update";
}

export function projectFileChange(diff: string, rawKind: unknown): FileChangeProjection {
  const kind = normalizeFileChangeKind(rawKind);
  if (kind === "add" || kind === "delete") {
    const sourceLines = logicalLines(diff);
    if (isUnifiedDiff(sourceLines)) return projectUnifiedDiff(sourceLines, kind);
    const marker = kind === "add" ? "+" : "-";
    return {
      kind,
      lines: sourceLines.map((line) => `${marker}${line}`),
      renderSource: sourceLines.map((line) => `${marker}${line}`).join("\n"),
      additions: kind === "add" ? sourceLines.length : 0,
      deletions: kind === "delete" ? sourceLines.length : 0,
    };
  }

  const lines = diff === "" ? [] : diff.split("\n");
  return projectUnifiedDiff(lines, kind);
}

function projectUnifiedDiff(lines: string[], kind: FileChangeKind): FileChangeProjection {
  let additions = 0;
  let deletions = 0;
  const visibleLines: string[] = [];
  let sawHunk = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("@@ ")) {
      sawHunk = true;
      continue;
    }
    if (isUnifiedDiffMetadata(lines, index, sawHunk)) continue;
    visibleLines.push(line);
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { kind, lines: visibleLines, renderSource: lines.join("\n"), additions, deletions };
}

function isUnifiedDiff(lines: string[]): boolean {
  return lines.some((line) => line.startsWith("@@ ") || line.startsWith("diff --git "));
}

function isUnifiedDiffMetadata(lines: string[], index: number, sawHunk: boolean): boolean {
  const line = lines[index] ?? "";
  return line.startsWith("diff --git ")
    || line.startsWith("index ")
    || (!sawHunk && line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ") === true)
    || (!sawHunk && line.startsWith("+++ ") && lines[index - 1]?.startsWith("--- ") === true)
    || line.startsWith("\\ No newline at end of file");
}

function logicalLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
