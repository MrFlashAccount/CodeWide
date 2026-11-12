import type { CodeReviewLineReference } from "../../comments/reviewComment";

/** A quote longer than this is cut: it is one ellipsized line in the composer. */
const LINE_TEXT_LIMIT = 400;
const HUNK_HEADER =
  /^@@ -(?<oldStart>\d+)(?:,(?<oldCount>\d+))? \+(?<newStart>\d+)(?:,(?<newCount>\d+))? @@/;

type LineSide = CodeReviewLineReference["side"];

/** One side's position inside the current hunk of a unified patch. */
type SideCursor = { line: number; remaining: number };

/** A tapped line and, when the document it was tapped in holds it, its text. */
export type TappedLine = {
  readonly line: number;
  readonly path: string;
  readonly side: LineSide;
  readonly text: string | undefined;
};

/** The tapped line as the native composer's anchor, quoting the line's text when known. */
export function lineReference(tapped: TappedLine): CodeReviewLineReference {
  const reference: CodeReviewLineReference = {
    coordinate: "file",
    line: tapped.line,
    path: tapped.path,
    side: tapped.side,
  };
  if (tapped.text !== undefined) {
    reference.context = tapped.text.slice(0, LINE_TEXT_LIMIT);
  }
  return reference;
}

/** The text of 1-based `line` of a complete file, without its line ending. */
export function sourceLineText(source: string | null, line: number): string | undefined {
  if (source === null || line < 1) {
    return undefined;
  }
  return withoutCarriageReturn(source.split("\n").at(line - 1));
}

/**
 * The text of 1-based `line` on one side of a unified patch: context lines
 * count on both sides, `-` lines on the old side and `+` lines on the new.
 */
export function patchLineText(patch: string, side: LineSide, line: number): string | undefined {
  const old: SideCursor = { line: 0, remaining: 0 };
  const next: SideCursor = { line: 0, remaining: 0 };
  for (const physicalLine of patch.split("\n")) {
    const header = HUNK_HEADER.exec(physicalLine)?.groups;
    if (header !== undefined) {
      startHunk(old, header.oldStart, header.oldCount);
      startHunk(next, header.newStart, header.newCount);
    } else if (old.remaining > 0 || next.remaining > 0) {
      const sideLine = step(side === "old" ? [old, next] : [next, old], side, physicalLine);
      if (sideLine === line) {
        return withoutCarriageReturn(physicalLine.slice(1));
      }
    }
  }
  return undefined;
}

/** Steps both sides past one hunk line; the line number it holds on `side`, if any. */
function step(
  [own, other]: readonly [SideCursor, SideCursor],
  side: LineSide,
  physicalLine: string,
): number | false {
  const marker = physicalLine.charAt(0);
  const ownMarker = side === "old" ? "-" : "+";
  advance(other, marker, ownMarker === "-" ? "+" : "-");
  return advance(own, marker, ownMarker);
}

function startHunk(cursor: SideCursor, start: string | undefined, count: string | undefined): void {
  cursor.line = Number(start);
  cursor.remaining = count === undefined ? 1 : Number(count);
}

/**
 * Steps one side past a patch line: a context line or the side's own marker
 * holds that side's next line number, any other line holds none (`false`).
 */
function advance(cursor: SideCursor, marker: string, own: "+" | "-"): number | false {
  if (marker !== " " && marker !== own) {
    return false;
  }
  const current = cursor.line;
  cursor.line += 1;
  cursor.remaining -= 1;
  return current;
}

function withoutCarriageReturn(text: string | undefined): string | undefined {
  return text?.replace(/\r$/, "");
}
