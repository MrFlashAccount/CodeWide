export const MIN_TABLE_COLUMN_WIDTH = 144;

export interface MarkdownTableLayout {
  cellWidth: number;
  tableWidth: number;
}

/** Fills the viewport when possible and scrolls only when columns need more room. */
export function markdownTableLayout(
  viewportWidth: number,
  columnCount: number,
): MarkdownTableLayout {
  const safeColumnCount = Math.max(1, columnCount);
  const tableWidth = Math.max(0, viewportWidth, safeColumnCount * MIN_TABLE_COLUMN_WIDTH);
  return { cellWidth: tableWidth / safeColumnCount, tableWidth };
}
