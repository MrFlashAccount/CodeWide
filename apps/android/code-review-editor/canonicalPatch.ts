import type { CodeReviewPatch } from "../src/rendering/code-review-bridge";

/** Adapt recorded patches to Pierre without changing file content or hunk counts. */
export function canonicalPatch(path: string, patch: CodeReviewPatch): string {
  const raw = patch.diff;
  if (/^---\s/m.test(raw) && /^\+\+\+\s/m.test(raw)) return restoreBlankContextPrefixes(raw);
  const normalizedPath = path.replace(/^\/+/, "");
  if (/^@@\s/m.test(raw)) return restoreBlankContextPrefixes(`--- a/${normalizedPath}\n+++ b/${normalizedPath}\n${raw}`);
  if (patch.kind === "update") throw new Error("Headerless update patch is not authoritative");
  const lines = logicalLines(raw);
  if (patch.kind === "add") {
    return `--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
  }
  return `--- a/${normalizedPath}\n+++ /dev/null\n@@ -1,${lines.length} +0,0 @@\n${lines.map((line) => `-${line}`).join("\n")}`;
}

function restoreBlankContextPrefixes(patch: string): string {
  let oldRemaining = 0;
  let newRemaining = 0;
  // Git's suppressBlankEmpty omits the context prefix on empty lines. Restore
  // only physical lines inside declared hunk bounds; Pierre still validates them.
  return patch.replace(/([^\n]*)(\n|$)/g, (physicalLine: string, line: string, ending: string) => {
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (header !== null) {
      oldRemaining = Number(header[1] ?? 1);
      newRemaining = Number(header[2] ?? 1);
      return physicalLine;
    }
    if (oldRemaining <= 0 && newRemaining <= 0) return physicalLine;
    if ((line === "" || line === "\r") && ending === "\n" && oldRemaining > 0 && newRemaining > 0) {
      oldRemaining -= 1;
      newRemaining -= 1;
      return ` ${physicalLine}`;
    }
    switch (line[0]) {
      case " ": oldRemaining -= 1; newRemaining -= 1; break;
      case "-": oldRemaining -= 1; break;
      case "+": newRemaining -= 1; break;
      case "\\": break;
      default: oldRemaining = 0; newRemaining = 0;
    }
    return physicalLine;
  });
}

function logicalLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
