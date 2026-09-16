import type { CodeReviewPatch } from "../editorBridge";

const DEFAULT_HUNK_LINE_COUNT = 1;
const NEW_HUNK_COUNT_INDEX = 2;

type HunkBalance = {
  newRemaining: number;
  oldRemaining: number;
};
type PhysicalLineInput = {
  balance: HunkBalance;
  ending: string;
  line: string;
  physicalLine: string;
};

/** Adapt recorded patches to Pierre without changing file content or hunk counts. */
export function canonicalPatch(path: string, patch: CodeReviewPatch): string {
  const raw = patch.diff;
  if (/^---\s/m.test(raw) && /^\+\+\+\s/m.test(raw)) {
    return restoreBlankContextPrefixes(raw);
  }
  const normalizedPath = path.replace(/^\/+/, "");
  if (/^@@\s/m.test(raw)) {
    return restoreBlankContextPrefixes(`--- a/${normalizedPath}\n+++ b/${normalizedPath}\n${raw}`);
  }
  if (patch.kind === "update") {
    throw new Error("Headerless update patch is not authoritative");
  }
  const lines = logicalLines(raw);
  const lineCount = String(lines.length);
  if (patch.kind === "add") {
    return `--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1,${lineCount} @@\n${lines.map((line) => `+${line}`).join("\n")}`;
  }
  return `--- a/${normalizedPath}\n+++ /dev/null\n@@ -1,${lineCount} +0,0 @@\n${lines.map((line) => `-${line}`).join("\n")}`;
}

function restoreBlankContextPrefixes(patch: string): string {
  const balance: HunkBalance = { newRemaining: 0, oldRemaining: 0 };
  // Git's suppressBlankEmpty omits the context prefix on empty lines. Restore
  // only physical lines inside declared hunk bounds; Pierre still validates them.
  return patch.replaceAll(/([^\n]*)(\n|$)/g, (physicalLine: string, line: string, ending: string) =>
    restorePhysicalLine({ balance, ending, line, physicalLine }),
  );
}

function restorePhysicalLine({ balance, ending, line, physicalLine }: PhysicalLineInput): string {
  const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
  if (header !== null) {
    balance.oldRemaining = hunkLineCount(header.at(1));
    balance.newRemaining = hunkLineCount(header.at(NEW_HUNK_COUNT_INDEX));
    return physicalLine;
  }
  if (balance.oldRemaining <= 0 && balance.newRemaining <= 0) {
    return physicalLine;
  }
  if (isRestorableBlankLine(balance, line, ending)) {
    balance.oldRemaining -= 1;
    balance.newRemaining -= 1;
    return ` ${physicalLine}`;
  }
  consumePhysicalLine(balance, line[0]);
  return physicalLine;
}

function isRestorableBlankLine(balance: HunkBalance, line: string, ending: string): boolean {
  return (
    (line === "" || line === "\r") &&
    ending === "\n" &&
    balance.oldRemaining > 0 &&
    balance.newRemaining > 0
  );
}

function hunkLineCount(value: string | undefined): number {
  return value === undefined ? DEFAULT_HUNK_LINE_COUNT : Number(value);
}

function consumePhysicalLine(balance: HunkBalance, prefix: string | undefined): void {
  switch (prefix) {
    case " ":
      balance.oldRemaining -= 1;
      balance.newRemaining -= 1;
      break;
    case "-":
      balance.oldRemaining -= 1;
      break;
    case "+":
      balance.newRemaining -= 1;
      break;
    case "\\":
      break;
    case undefined:
    default:
      balance.oldRemaining = 0;
      balance.newRemaining = 0;
  }
}

function logicalLines(value: string): string[] {
  if (value === "") {
    return [];
  }
  const lines = value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}
