import type { TNode } from "@native-html/render";

export interface MarkupTableCell {
  readonly node: TNode;
  readonly row: number;
  readonly column: number;
  readonly rowSpan: number;
  readonly colSpan: number;
}
export interface MarkupTableGrid {
  readonly cells: readonly MarkupTableCell[];
  readonly rows: number;
  readonly columns: number;
}
interface TableRow { readonly node: TNode; readonly remaining: number }

/** Places HTML cells without overlapping active rowspans; zero spans the remaining rows. */
export function markupTableGrid(table: TNode): MarkupTableGrid {
  const rows: TableRow[] = [];
  collectRows(table, rows);
  const occupiedUntil: number[] = [];
  const cells: MarkupTableCell[] = [];
  let columns = 1;
  for (const [row, element] of rows.entries()) {
    let column = 0;
    for (const node of element.node.children) {
      if (node.tagName !== "td" && node.tagName !== "th") continue;
      const rawRowSpan = span(node.attributes.rowspan, 0, 65534);
      const colSpan = span(node.attributes.colspan, 1, 1000);
      column = availableColumn(occupiedUntil, row, column, colSpan);
      const rowSpan = Math.min(rawRowSpan === 0 ? element.remaining : rawRowSpan, element.remaining);
      cells.push({ node, row, column, rowSpan, colSpan });
      for (let offset = 0; offset < colSpan; offset += 1) occupiedUntil[column + offset] = row + rowSpan;
      column += colSpan;
      columns = Math.max(columns, column);
    }
  }
  return { cells, rows: rows.length, columns };
}

function collectRows(node: TNode, rows: TableRow[]): void {
  let remaining = node.children.reduce((count, child) => count + (child.tagName === "tr" ? 1 : 0), 0);
  for (const child of node.children) {
    if (child.tagName === "tr") {
      rows.push({ node: child, remaining });
      remaining -= 1;
    }
    else if (["thead", "tbody", "tfoot"].includes(child.tagName ?? "")) collectRows(child, rows);
  }
}

function availableColumn(occupied: readonly number[], row: number, start: number, width: number): number {
  let column = start;
  for (let offset = 0; offset < width; offset += 1) {
    if ((occupied[column + offset] ?? 0) > row) {
      column += offset + 1;
      offset = -1;
    }
  }
  return column;
}

function span(value: string | undefined, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return value !== undefined && Number.isSafeInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : 1;
}

/** Measured spanning cells distribute their extra height over the rows they own. */
export function markupTableRowHeights(grid: MarkupTableGrid, measured: Readonly<Record<number, number>>, minimum: number): number[] {
  const heights = Array<number>(grid.rows).fill(minimum);
  for (const [index, cell] of grid.cells.entries()) {
    let available = 0;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) available += heights[row] ?? 0;
    const extra = Math.max(0, (measured[index] ?? minimum) - available) / cell.rowSpan;
    for (let row = cell.row; row < cell.row + cell.rowSpan; row += 1) heights[row] = (heights[row] ?? 0) + extra;
  }
  return heights;
}
