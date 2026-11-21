import type { Table } from "mdast";
import { useContext, useState, type ReactElement } from "react";
import { useWindowDimensions } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../ui/typography-policy";
import { MarkdownTableHost, type TableHeightEvent } from "./nativeMarkdownTableHost";
import { plainMarkdownTable, type PlainMarkdownTable } from "./plainMarkdownTable";
import { richMarkdownGeometry } from "./richMarkdownGeometry";
import { useRichMarkdownPremeasurement } from "./richMarkdownLayoutPolicy";
import { SearchHighlightQuery } from "./SearchMessageFocus";

/** Draws a completed chat table with one Fabric host when its cell semantics can be preserved. */
export function NativeMarkdownTable({
  children,
  table,
  width,
}: {
  children: ReactElement;
  table: Table;
  width: number;
}): ReactElement {
  const query = useContext(SearchHighlightQuery);
  const policy = useRichMarkdownPremeasurement();
  if (MarkdownTableHost === null || query !== "" || policy !== null) {
    return children;
  }
  const grid = plainMarkdownTable(table);
  return grid === null ? (
    children
  ) : (
    <MeasuredGrid grid={grid} host={MarkdownTableHost} width={width} />
  );
}

function MeasuredGrid({
  grid,
  host: Host,
  width,
}: {
  grid: PlainMarkdownTable;
  host: NonNullable<typeof MarkdownTableHost>;
  width: number;
}): ReactElement {
  const { fontScale, scale } = useWindowDimensions();
  const multiplier = Math.min(fontScale, APP_MAX_FONT_SIZE_MULTIPLIER);
  const [measured, setMeasured] = useState<number | null>(null);
  const content = {
    ...grid,
    font: productFonts.medium,
    fontSize: typeScale.label.fontSize * multiplier,
    headerColor: colors.surfaceHover,
    headerFont: productFonts.semibold,
    lineHeight: typeScale.label.lineHeight * multiplier,
    paddingX: richMarkdownGeometry.tableCellPaddingHorizontal,
    paddingY: richMarkdownGeometry.tableCellPaddingVertical,
    ruleColor: colors.borderSoft,
    stroke: richMarkdownGeometry.tableRowBorderWidth,
    textColor: colors.text,
  };
  const verticalPadding = Math.round(content.paddingY * scale);
  const rowPixels =
    Math.round(content.lineHeight * scale) +
    verticalPadding +
    verticalPadding +
    Math.round(content.stroke * scale);
  const estimate = (grid.rowCount * rowPixels) / scale;
  const resize = useEvent(({ nativeEvent }: TableHeightEvent) => {
    setMeasured(nativeEvent.height);
  });
  return (
    <Host grid={content} onTableHeight={resize} style={{ height: measured ?? estimate, width }} />
  );
}
