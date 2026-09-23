import { TNodeChildrenRenderer, type CustomRendererProps, type TBlock } from "@native-html/render";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../theme";
import { RichContentWidthProvider } from "./RichContentLayout";
import {
  markupTableGrid,
  markupTableRowHeights,
  type MarkupTableCell,
} from "./markup-table-layout";
import { NativeRevealSurface } from "./NativeRevealSurface";
import { markupNodePath } from "./markup-node-path";
import { useStreamingRevealKey } from "./streaming-reveal-context";
import { FluidLayoutFrame } from "./FluidLayoutFrame";
import { useTableViewport } from "./useTableViewport";

/** The upstream native table plugin does not handle HTML rowspan=0; keep this measured layout. */
export function NativeMarkupTable(props: CustomRendererProps<TBlock>) {
  const viewport = useTableViewport();
  const streamKey = useStreamingRevealKey();
  const [measured, setMeasured] = useState<Readonly<Record<number, number>>>({});
  const grid = markupTableGrid(props.tnode);
  const heights = markupTableRowHeights(grid, measured, typeScale.body.lineHeight + spacing.xs * 2);
  const offsets = [0];
  for (const height of heights) {
    offsets.push((offsets[offsets.length - 1] ?? 0) + height);
  }
  const cellWidth = Math.max(120, viewport.contentWidth / grid.columns);
  const caption = props.tnode.children.find((child) => child.tagName === "caption");
  const rows: { cell: MarkupTableCell; index: number }[][] = Array.from(
    { length: grid.rows },
    () => [],
  );
  grid.cells.forEach((cell, index) => {
    rows[cell.row]?.push({ cell, index });
  });
  return (
    <FluidLayoutFrame
      animate={streamKey !== null}
      onLayout={viewport.onLayout}
      style={[styles.viewport, { width: viewport.width }]}
      testID="markup-table-viewport"
    >
      {caption !== undefined && <TNodeChildrenRenderer tnode={caption} />}
      <ScrollView horizontal nestedScrollEnabled style={styles.scroller}>
        <View
          style={[
            styles.table,
            { height: offsets[offsets.length - 1] ?? 0, width: cellWidth * grid.columns },
          ]}
        >
          {rows.map((cells, row) => (
            <NativeRevealSurface
              animate={streamKey !== null}
              delayMs={Math.min(row * 35, 105)}
              key={row}
              ready={
                streamKey === null || cells.every(({ index }) => measured[index] !== undefined)
              }
              revealKey={`${markupNodePath(props.tnode)}:row:${String(row)}`}
              style={{
                height: Math.max(
                  heights[row] ?? 0,
                  ...cells.map(
                    ({ cell }) => (offsets[row + cell.rowSpan] ?? 0) - (offsets[row] ?? 0),
                  ),
                ),
                position: "absolute",
                top: offsets[row] ?? 0,
                width: cellWidth * grid.columns,
              }}
            >
              {cells.map(({ cell, index }) => (
                <View
                  key={index}
                  style={[
                    styles.cell,
                    cell.node.tagName === "th" && styles.header,
                    {
                      height: (offsets[cell.row + cell.rowSpan] ?? 0) - (offsets[cell.row] ?? 0),
                      left: cell.column * cellWidth,
                      top: 0,
                      width: cellWidth * cell.colSpan,
                    },
                  ]}
                >
                  <View
                    onLayout={(event) => {
                      const height = Math.ceil(event.nativeEvent.layout.height);
                      setMeasured((previous) =>
                        previous[index] === height ? previous : { ...previous, [index]: height },
                      );
                    }}
                    style={styles.content}
                    testID={`markup-table-cell-${String(cell.row)}-${String(cell.column)}`}
                  >
                    <RichContentWidthProvider width={cellWidth * cell.colSpan - spacing.xs * 2}>
                      <TNodeChildrenRenderer tnode={cell.node} />
                    </RichContentWidthProvider>
                  </View>
                </View>
              ))}
            </NativeRevealSurface>
          ))}
        </View>
      </ScrollView>
    </FluidLayoutFrame>
  );
}

const styles = StyleSheet.create({
  cell: {
    borderColor: colors.outline,
    borderWidth: StyleSheet.hairlineWidth,
    position: "absolute",
  },
  content: { padding: spacing.xs },
  header: { backgroundColor: colors.surfaceContainerHigh },
  scroller: { width: "100%" },
  table: {
    borderColor: colors.outline,
    borderWidth: StyleSheet.hairlineWidth,
  },
  viewport: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
});
