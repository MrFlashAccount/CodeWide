import React from "react";
import {
  NativeModules,
  requireNativeComponent,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { LegendList } from "@legendapp/list/react-native";
import { colors, iconSize, radii, spacing, typeScale } from "../../src/theme";
import { productFonts } from "../../src/ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../src/ui/typography-policy";
import { RichMarkdownDocumentBlockView } from "../../src/rendering/RichMarkdown";
import { groupChatMarkdownList } from "../../src/rendering/markdownListGroups";
import { plainMarkdownTable } from "../../src/rendering/plainMarkdownTable";
import { markdownTableLayout } from "../../src/rendering/markdown-table-layout";
import { richMarkdownGeometry as geometry } from "../../src/rendering/richMarkdownGeometry";
import { useEvent } from "../../src/react/useEvent";

import { hostedTimeline } from "./HostedTimeline";

const Probe = requireNativeComponent("CodeWideLabProbe");
const Host = requireNativeComponent("CodeWideLabTranscript");
const mode =
  NativeModules.CodeWideNative?.getConstants?.().threadLabMode ??
  NativeModules.CodeWideNative?.threadLabMode ??
  "stock";

// An isolated range deliberately excludes message chrome. Both arms read exactly the same
// projected blocks. The full-thread arms use the actual conversation renderer for every row.
export function studyViewport(standard, props, timelineRows) {
  const range = /^(native|reference)-(list|paragraph|table)$/.test(mode);
  return (
    <Probe style={styles.fill} testID={range ? "lab-probe-range" : "lab-probe-mixed"}>
      {viewport(standard, props, timelineRows)}
    </Probe>
  );
}

function viewport(standard, props, timelineRows) {
  if (mode === "stock") return standard;
  if (mode === "hosted-mixed") return hostedTimeline(standard, props);
  if (mode === "mixed-audit") {
    return <Coverage rows={timelineRows} standard={standard} />;
  }
  const match = /^(native|reference)-(paragraph|list|table)$/.exec(mode);
  if (!match) return standard;
  return (
    <Study
      key={props.composerScope}
      arm={match[1]}
      kind={match[2]}
      props={props}
      rows={timelineRows}
    />
  );
}

function Coverage({ rows, standard }) {
  const counts = new Map();
  function count(name) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const row of rows) {
    count(row.kind);
    for (const part of row.parts ?? []) {
      count(part.kind === "markdownBlock" ? part.block.node.type : part.kind);
    }
  }
  const summary = [...counts]
    .map(([kind, n]) => kind + "=" + String(n))
    .sort()
    .join(",");
  return (
    <View style={styles.fill} testID={"lab-stock-fallback-" + summary}>
      {standard}
    </View>
  );
}

function blocksForRange(rows, kind) {
  const result = [];
  const visited = new Set();
  for (const row of rows) {
    if (row.kind !== "turnSlice") continue;
    for (const part of row.parts) {
      if (part.kind !== "markdownBlock" || part.streaming || part.block.node.type !== kind)
        continue;
      const block = part.block;
      if (kind === "paragraph" && !block.node.children.every((child) => child.type === "text"))
        continue;
      if (kind === "table" && plainMarkdownTable(block.node) === null) continue;
      const blocks =
        kind === "list"
          ? block.listGroup
            ? [block]
            : (groupChatMarkdownList(block) ?? [])
          : [block];
      for (const candidate of blocks) {
        const id = [
          row.item.id,
          part.response.key,
          candidate.key,
          candidate.listGroup?.firstItem ?? "",
        ].join("/");
        if (visited.has(id)) continue;
        visited.add(id);
        result.push({ key: id, block: candidate });
      }
    }
  }
  return result;
}

function makeNativeModel(item, kind, multiplier, width, density) {
  const { block, key } = item;
  const gapAfter = geometry.blockGap;
  if (kind === "list")
    return {
      key,
      kind,
      model: {
        checkedColor: colors.green,
        font: productFonts.regular,
        fontSize: typeScale.body.fontSize * multiplier,
        gap: geometry.listGap,
        gapAfter,
        iconSize: iconSize.inline,
        inset: geometry.listInset,
        lineHeight: typeScale.body.lineHeight * multiplier,
        lines: block.listGroup.lines,
        markerColor: colors.textMuted,
        markerGap: geometry.listRowGap,
        nestedGap: geometry.listBodyGap,
        review: false,
        textColor: colors.text,
      },
    };
  if (kind === "table") {
    const grid = plainMarkdownTable(block.node);
    const layout = markdownTableLayout(width, grid.alignments.length);
    const lineHeight = typeScale.label.lineHeight * multiplier;
    const singleLinePx =
      Math.round(lineHeight * density) +
      2 * Math.round(geometry.tableCellPaddingVertical * density) +
      Math.round(geometry.tableRowBorderWidth * density);
    return {
      key,
      kind,
      model: {
        ...grid,
        borderWidth: geometry.tableBorderWidth,
        borderColor: colors.border,
        radius: radii.small,
        width: layout.tableWidth,
        height: (singleLinePx * grid.rowCount) / density,
        font: productFonts.medium,
        fontSize: typeScale.label.fontSize * multiplier,
        headerFont: productFonts.semibold,
        headerColor: colors.surfaceHover,
        textColor: colors.text,
        ruleColor: colors.borderSoft,
        paddingX: geometry.tableCellPaddingHorizontal,
        paddingY: geometry.tableCellPaddingVertical,
        stroke: geometry.tableRowBorderWidth,
        lineHeight,
        gapAfter,
      },
    };
  }
  return {
    key,
    kind,
    model: {
      text: block.node.children.map((child) => child.value).join(""),
      font: productFonts.regular,
      textColor: colors.text,
      fontSize: typeScale.body.fontSize * multiplier,
      lineHeight: typeScale.body.lineHeight * multiplier,
      gapAfter,
    },
  };
}

function Study({ arm, kind, props, rows }) {
  const dimensions = useWindowDimensions();
  const selected = blocksForRange(rows, kind);
  const multiplier = Math.min(dimensions.fontScale, APP_MAX_FONT_SIZE_MULTIPLIER);
  const [width, setWidth] = React.useState(0);
  const layout = useEvent((event) => {
    const w = event.nativeEvent.layout.width;
    if (w > 0) setWidth(w);
  });
  const ready = useEvent(() => {
    if (selected.length > 0) props.commitInitialTimelineLoad();
  });
  const render = ({ item, index }) => (
    <View style={index === selected.length - 1 ? undefined : styles.gap}>
      <RichMarkdownDocumentBlockView completedChat block={item.block} />
    </View>
  );
  return (
    <View testID="conversation-timeline" style={styles.study}>
      <View
        onLayout={layout}
        style={styles.fill}
        testID={"lab-" + arm + "-" + kind + "-" + selected.length}
      >
        {selected.length > 0 &&
          width > 0 &&
          (arm === "native" ? (
            <Host
              style={styles.fill}
              testID="lab-transcript-ink"
              onLayout={ready}
              window={{
                scope: props.composerScope,
                rows: selected.map((item) =>
                  makeNativeModel(item, kind, multiplier, width, dimensions.scale),
                ),
              }}
            />
          ) : (
            <View style={styles.fill} testID="lab-transcript-ink" onLayout={ready}>
              <LegendList
                style={styles.fill}
                data={selected}
                keyExtractor={(item) => item.key}
                renderItem={render}
                estimatedItemSize={100}
                recycleItems={false}
                showsVerticalScrollIndicator={false}
              />
            </View>
          ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  fill: { flex: 1 },
  gap: { paddingBottom: geometry.blockGap },
  study: {
    flex: 1,
    marginHorizontal: spacing.md,
    marginTop: 64,
    marginBottom: 120,
    backgroundColor: colors.messageSurface,
  },
});
