export const MIN_TABLE_COLUMN_WIDTH = 144;

export function markdownTableLayout(viewportWidth: number, columnCount: number): {
  tableWidth: number;
  cellWidth: number;
} {
  const safeColumnCount = Math.max(1, columnCount);
  const tableWidth = Math.max(0, viewportWidth, safeColumnCount * MIN_TABLE_COLUMN_WIDTH);
  return { tableWidth, cellWidth: tableWidth / safeColumnCount };
}
