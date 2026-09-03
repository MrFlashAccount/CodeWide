import type { Table, TableCell } from "mdast";
import { ScrollView, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { renderMarkdownInline } from "./MarkdownInline";
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

const MIN_TABLE_CELL_WIDTH = 144;

export function MarkdownTable(props: MarkdownTableProps): React.JSX.Element {
  const { table } = props;
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  const tableWidth = MIN_TABLE_CELL_WIDTH * columnCount;
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
      style={styles.viewport}
    >
      <View style={[styles.table, { width: tableWidth }]}>
        {table.children.map((row, rowIndex) => (
          <View
            key={markdownNodeKey(row, "table-row")}
            style={[styles.row, rowIndex === 0 ? styles.header : null]}
          >
            {row.children.map((cell, cellIndex) => (
              <TableCellView
                key={markdownNodeKey(cell, "table-cell")}
                align={table.align?.[cellIndex] ?? null}
                cell={cell}
                header={rowIndex === 0}
                width={MIN_TABLE_CELL_WIDTH}
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
    minWidth: MIN_TABLE_CELL_WIDTH,
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
