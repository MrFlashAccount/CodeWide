/**
 * The pure projection of a review thread's code excerpt into rows: gutters,
 * the diff marker, the tone and which rows the thread is anchored on.
 */
import type {
  CodeExcerpt,
  ExcerptLine,
  ThreadAnchor,
} from "../../../data/forgeConversationContract";

/** One drawn excerpt row. */
export type ExcerptRow = {
  /** The thread is anchored on this line: the last row, and every row of a line range. */
  readonly anchored: boolean;
  readonly kind: ExcerptLine["kind"];
  /** `+`, `-` or a space. */
  readonly marker: string;
  /** The old-side line number, empty for an added line. */
  readonly newLabel: string;
  readonly oldLabel: string;
  readonly text: string;
};

const MARKERS = { added: "+", context: " ", removed: "-" } as const;

/** The line's number on one side of the diff, `null` when the line is not on that side. */
function numberOn(line: ExcerptLine, side: "new" | "old"): number | null {
  if (line.kind === "context") {
    return side === "new" ? line.newLine : line.oldLine;
  }
  if (line.kind === "added") {
    return side === "new" ? line.newLine : null;
  }
  return side === "old" ? line.oldLine : null;
}

/** The line's own number: the new side unless it exists only on the old one. */
function ownNumber(line: ExcerptLine): number {
  return line.kind === "removed" ? line.oldLine : line.newLine;
}

/** Projects the excerpt into rows; the anchored range comes from a `line` anchor. */
export function excerptRows(excerpt: CodeExcerpt, anchor: ThreadAnchor): readonly ExcerptRow[] {
  const last = excerpt.lines.length - 1;
  return excerpt.lines.map((line, index) => {
    let anchored = index === last;
    if (!anchored && anchor.kind === "line" && anchor.startLine !== null) {
      const number = numberOn(line, anchor.side);
      anchored = number !== null && number >= anchor.startLine && number <= anchor.line;
    }
    const oldNumber = numberOn(line, "old");
    const newNumber = numberOn(line, "new");
    return {
      anchored,
      kind: line.kind,
      marker: MARKERS[line.kind],
      newLabel: newNumber === null ? "" : String(newNumber),
      oldLabel: oldNumber === null ? "" : String(oldNumber),
      text: line.text,
    };
  });
}

/** What a screen reader hears for the excerpt: `Code at src/a.rs lines 40 to 42`. */
export function excerptLabel(excerpt: CodeExcerpt, anchor: ThreadAnchor): string {
  const first = ownNumber(excerpt.lines[0]);
  const last = ownNumber(excerpt.lines.at(-1) ?? excerpt.lines[0]);
  const where = anchor.kind === "pullRequest" ? "" : ` at ${anchor.path}`;
  const lines =
    first === last ? `line ${String(last)}` : `lines ${String(first)} to ${String(last)}`;
  return `Code${where} ${lines}`;
}
