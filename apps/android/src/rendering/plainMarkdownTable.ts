import type { Table, TableCell } from "mdast";

type Alignment = "center" | "left" | "right";

/** Geometry and cell values for a rectangular, text-only Android grid. */
export type PlainMarkdownTable = Readonly<{
  alignments: readonly Alignment[];
  cells: readonly string[];
  rowCount: number;
}>;

// A native grid binds its cells in one UI-thread transaction. Keep unusually large
// tables on the existing rendering path until their rows can be mounted independently.
const MAX_GRID_CELLS = 128;
const MAX_GRID_CHARACTERS = 32_768;

function cellText(cell: TableCell): string | null {
  if (cell.children.length === 0) {
    return "";
  }
  const only = cell.children[0];
  return cell.children.length === 1 && only?.type === "text" ? only.value : null;
}

function columnAlignments(table: Table, columns: number): Alignment[] {
  return Array.from({ length: columns }, (_, index) => table.align?.[index] ?? "left");
}

function readCells(table: Table, columns: number): string[] | null {
  const cells: string[] = [];
  let characters = 0;
  for (const row of table.children) {
    if (row.children.length !== columns) {
      return null;
    }
    for (const cell of row.children) {
      const text = cellText(cell);
      if (text === null) {
        return null;
      }
      characters += text.length;
      if (characters > MAX_GRID_CHARACTERS) {
        return null;
      }
      cells.push(text);
    }
  }
  return cells;
}

/** Preserves Markdown interactions by admitting only complete, rectangular plain-text cells. */
export function plainMarkdownTable(table: Table): PlainMarkdownTable | null {
  const columns = table.children[0]?.children.length ?? 0;
  const rowCount = table.children.length;
  if (columns === 0 || columns * rowCount > MAX_GRID_CELLS) {
    return null;
  }
  const cells = readCells(table, columns);
  return cells === null ? null : { alignments: columnAlignments(table, columns), cells, rowCount };
}
