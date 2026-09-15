import { TNodeChildrenRenderer, type CustomRendererProps, type TBlock } from "@native-html/render";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../theme";
import { RichContentWidthProvider, useRichContentWidth } from "./RichContentLayout";
import {
  markupTableGrid,
  markupTableRowHeights,
  type MarkupTableCell,
} from "./markup-table-layout";
import { NativeRevealSurface } from "./NativeRevealSurface";
import { markupNodePath } from "./markup-node-path";
import { useStreamingRevealKey } from "./streaming-reveal-context";
import { FluidLayoutFrame } from "./FluidLayoutFrame";

/** The upstream native table plugin does not handle HTML rowspan=0; keep this measured layout. */
export function NativeMarkupTable(props: CustomRendererProps<TBlock>) {
  const available = useRichContentWidth() ?? 0;
  const streamKey = useStreamingRevealKey();
  const [measured, setMeasured] = useState<Readonly<Record<number, number>>>({});
  const grid = markupTableGrid(props.tnode);
  const heights = markupTableRowHeights(grid, measured, typeScale.body.lineHeight + spacing.xs * 2);
  const offsets = [0];
  for (const height of heights) offsets.push((offsets[offsets.length - 1] ?? 0) + height);
  const cellWidth = Math.max(120, available / grid.columns);
  const caption = props.tnode.children.find((child) => child.tagName === "caption");
  const rows: { cell: MarkupTableCell; index: number }[][] = Array.from(
    { length: grid.rows },
    () => [],
  );
  grid.cells.forEach((cell, index) => rows[cell.row]?.push({ cell, index }));
  return (
    <FluidLayoutFrame animate={streamKey !== null}>
      {caption !== undefined && <TNodeChildrenRenderer tnode={caption} />}
      <ScrollView
        horizontal
        nestedScrollEnabled
        style={available > 0 ? { width: available } : undefined}
      >
        <View
          style={[
            styles.table,
            { width: cellWidth * grid.columns, height: offsets[offsets.length - 1] ?? 0 },
          ]}
        >
          {rows.map((cells, row) => (
            <NativeRevealSurface
              key={row}
              animate={streamKey !== null}
              delayMs={Math.min(row * 35, 105)}
              ready={
                streamKey === null || cells.every(({ index }) => measured[index] !== undefined)
              }
              revealKey={`${markupNodePath(props.tnode)}:row:${row}`}
              style={{
                position: "absolute",
                top: offsets[row] ?? 0,
                width: cellWidth * grid.columns,
                height: Math.max(
                  heights[row] ?? 0,
                  ...cells.map(
                    ({ cell }) => (offsets[row + cell.rowSpan] ?? 0) - (offsets[row] ?? 0),
                  ),
                ),
              }}
            >
              {cells.map(({ cell, index }) => (
                <View
                  key={index}
                  style={[
                    styles.cell,
                    cell.node.tagName === "th" && styles.header,
                    {
                      left: cell.column * cellWidth,
                      top: 0,
                      width: cellWidth * cell.colSpan,
                      height: (offsets[cell.row + cell.rowSpan] ?? 0) - (offsets[cell.row] ?? 0),
                    },
                  ]}
                >
                  <View
                    testID={`markup-table-cell-${cell.row}-${cell.column}`}
                    style={styles.content}
                    onLayout={(event) => {
                      const height = Math.ceil(event.nativeEvent.layout.height);
                      setMeasured((previous) =>
                        previous[index] === height ? previous : { ...previous, [index]: height },
                      );
                    }}
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
  table: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outline,
  },
  cell: {
    position: "absolute",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.outline,
  },
  content: { padding: spacing.xs },
  header: { backgroundColor: colors.surfaceContainerHigh },
});
