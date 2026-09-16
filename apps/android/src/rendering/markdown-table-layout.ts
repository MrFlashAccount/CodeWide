const MIN_TABLE_COLUMN_WIDTH = 144;

export function markdownTableLayout(
  viewportWidth: number,
  columnCount: number,
): {
  cellWidth: number;
  tableWidth: number;
} {
  const safeColumnCount = Math.max(1, columnCount);
  const tableWidth = Math.max(0, viewportWidth, safeColumnCount * MIN_TABLE_COLUMN_WIDTH);
  return { cellWidth: tableWidth / safeColumnCount, tableWidth };
}
