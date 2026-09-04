import type { Table, TableCell } from "mdast";
import { useState } from "react";
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, typeScale, typeWeight } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { renderMarkdownInline } from "./MarkdownInline";
import { markdownTableLayout, MIN_TABLE_COLUMN_WIDTH } from "./markdownTableLayout";
import { markdownNodeKey } from "./richMarkdownModel";

interface MarkdownTableProps {
  table: Table;
}

interface TableCellViewProps {
  align: "center" | "left" | "right" | null;
  cell: TableCell;
  header: boolean;
  width: number;
}

export function MarkdownTable(props: MarkdownTableProps): React.JSX.Element {
  const { table } = props;
  const [viewportWidth, setViewportWidth] = useState(0);
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  const { cellWidth, tableWidth } = markdownTableLayout(viewportWidth, columnCount);
  const updateViewportWidth = useEvent((event: LayoutChangeEvent): void => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setViewportWidth((current) => (current === width ? current : width));
  });
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      onLayout={updateViewportWidth}
      showsHorizontalScrollIndicator
      style={styles.viewport}
      testID="markdown-table-viewport"
    >
      <View style={[styles.table, { width: tableWidth }]} testID="markdown-table">
        {table.children.map((row, rowIndex) => (
          <View
            key={`${markdownNodeKey(row, "table-row")}:${String(rowIndex)}`}
            style={[styles.row, rowIndex === 0 ? styles.header : null]}
          >
            {row.children.map((cell, cellIndex) => (
              <TableCellView
                key={`${markdownNodeKey(cell, "table-cell")}:${String(cellIndex)}`}
                align={table.align?.[cellIndex] ?? null}
                cell={cell}
                header={rowIndex === 0}
                width={cellWidth}
              />
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function TableCellView(props: TableCellViewProps): React.JSX.Element {
  const { align, cell, header, width } = props;
  return (
    <Text
      style={[
        styles.cell,
        header ? styles.cellHeader : null,
        { textAlign: align ?? "left", width },
      ]}
    >
      {renderMarkdownInline(cell.children)}
    </Text>
  );
}

const styles = StyleSheet.create({
  cell: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: 1,
    color: colors.text,
    flexShrink: 0,
    minWidth: MIN_TABLE_COLUMN_WIDTH,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    ...typeScale.label,
  },
  cellHeader: { fontWeight: typeWeight.semibold },
  header: { backgroundColor: colors.surfaceHover },
  row: { borderBottomColor: colors.borderSoft, borderBottomWidth: 1, flexDirection: "row" },
  table: {
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    overflow: "hidden",
  },
  viewport: { alignSelf: "stretch", flexGrow: 0, maxWidth: "100%", minWidth: 0, width: "100%" },
});
