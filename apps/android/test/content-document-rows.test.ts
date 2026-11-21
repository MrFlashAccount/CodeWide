import { describe, expect, it } from "vitest";

import {
  appendContentChunk,
  pendingContentRows,
  startContentPart,
  type ContentDocumentRow,
  type ContentPartCursor,
} from "../src/features/conversation/content/contentDocumentRows";
import { projectTerminalText } from "../src/rendering/terminalAnsiText";

/** Reads `chunks` into one part as the viewer would, the last one completing it. */
function readChunks(
  presentation: ContentPartCursor["presentation"],
  chunks: readonly string[],
): readonly ContentDocumentRow[] {
  let cursor = startContentPart(0, presentation);
  const rows: ContentDocumentRow[] = [];
  chunks.forEach((chunk, index) => {
    const step = appendContentChunk(cursor, chunk, index === chunks.length - 1);
    rows.push(...step.rows);
    cursor = step.cursor;
  });
  return rows;
}

function rowText(row: ContentDocumentRow): string {
  if (row.kind === "terminal") {
    return row.runs.map((run) => run.text).join("");
  }
  return row.kind === "markdown" ? row.block.node.type : row.text;
}

describe("content document rows", () => {
  it("joins a line split between chunks into one continuous text", () => {
    const whole = "alpha\nbeta\ngamma\n";
    const rows = readChunks("text", ["alpha\nbe", "ta\nga", "mma\n"]);
    expect(rows.map(rowText).join("\n")).toBe("alpha\nbeta\ngamma");
    expect(readChunks("text", [whole]).map(rowText).join("\n")).toBe("alpha\nbeta\ngamma");
  });

  it("shows the unfinished line as the row its next chunk completes", () => {
    const first = appendContentChunk(startContentPart(0, "text"), "alpha\nbe", false);
    const [pending] = pendingContentRows(first.cursor);
    const second = appendContentChunk(first.cursor, "ta\n", true);
    expect(pending).toMatchObject({ kind: "text", text: "be" });
    expect(second.rows).toEqual([{ key: pending?.key, kind: "text", text: "beta" }]);
  });

  it("keeps an empty line and drops nothing for an empty part", () => {
    expect(readChunks("text", ["a\n\nb"]).map(rowText).join("\n")).toBe("a\n\nb");
    expect(readChunks("text", [""])).toEqual([]);
  });

  it("carries terminal colors across a chunk boundary", () => {
    const rows = readChunks("terminal", ["\u001B[31mred\nstill", " red\n\u001B[0mplain\n"]);
    const runs = rows.flatMap((row) => (row.kind === "terminal" ? row.runs : []));
    expect(runs.map((run) => [run.text, run.style.foreground])).toEqual([
      ["red", "#cc6666"],
      ["still red\n", "#cc6666"],
      ["plain", null],
    ]);
  });

  it("keeps a fenced code block split between chunks one Markdown block", () => {
    const rows = readChunks("markdown", ["# Title\n\n```ts\nconst a = 1;\n", "const b = 2;\n```\n\nEnd.\n"]);
    expect(rows.map(rowText)).toEqual(["heading", "code", "paragraph"]);
    const code = rows.find((row) => row.kind === "markdown" && row.block.node.type === "code");
    expect(code?.kind === "markdown" ? code.block.node : null).toMatchObject({
      value: "const a = 1;\nconst b = 2;",
    });
  });
});

describe("terminal text projection", () => {
  it("removes cursor, OSC and other control sequences and keeps the text", () => {
    const projected = projectTerminalText(
      "\u001B]0;title\u0007\u001B[2Kdone\u001B[1m!\u001B[22m\r\nnext\rover",
    );
    expect(projected.runs.map((run) => run.text).join("")).toBe("done!\nnext\nover");
    expect(projected.runs.find((run) => run.text === "!")?.style.bold).toBe(true);
  });

  it("maps 256-color and RGB foregrounds as the native renderer does", () => {
    const projected = projectTerminalText("\u001B[38;5;196ma\u001B[38;2;1;2;3mb\u001B[38;5;244mc");
    expect(projected.runs.map((run) => run.style.foreground)).toEqual(["#ff0000", "#010203", "#808080"]);
  });
});
