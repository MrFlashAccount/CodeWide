import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import type {
  ReviewDiffLine,
  ReviewLineAnchor,
  ReviewSplitLine,
  ReviewViewMode,
} from "../../rendering/review/reviewModel";
import { ProductText } from "../text/ProductText";
import { ReviewLineView } from "./ReviewLineView";

interface ReviewDiffViewProps {
  lines: ReviewDiffLine[];
  mode: ReviewViewMode;
  onSelectAnchor(anchor: ReviewLineAnchor): void;
  selectedAnchor: ReviewLineAnchor | null;
  splitLines: ReviewSplitLine[];
  truncated: boolean;
  wrapLines: boolean;
}

type RenderableReviewRow =
  | {
      key: string;
      kind: "line";
      line: ReviewDiffLine;
      onSelectAnchor(anchor: ReviewLineAnchor): void;
      selectedAnchor: ReviewLineAnchor | null;
      wrapLines: boolean;
    }
  | {
      key: string;
      kind: "split";
      line: ReviewSplitLine;
      onSelectAnchor(anchor: ReviewLineAnchor): void;
      selectedAnchor: ReviewLineAnchor | null;
      wrapLines: boolean;
    };

export function ReviewDiffView(props: ReviewDiffViewProps): React.JSX.Element {
  const { lines, mode, onSelectAnchor, selectedAnchor, splitLines, truncated, wrapLines } = props;
  const data: RenderableReviewRow[] =
    mode === "split"
      ? splitLines.map((line) => ({
          key: `split:${line.key}`,
          kind: "split",
          line,
          onSelectAnchor,
          selectedAnchor,
          wrapLines,
        }))
      : lines.map((line, index) => ({
          key: reviewLineKey(line, index),
          kind: "line",
          line,
          onSelectAnchor,
          selectedAnchor,
          wrapLines,
        }));
  return (
    <LegendList
      contentContainerStyle={styles.content}
      data={data}
      dataKey={`review:${mode}:${wrapLines ? "wrap" : "nowrap"}`}
      drawDistance={420}
      estimatedItemSize={wrapLines ? 44 : 24}
      keyExtractor={reviewRowKey}
      ListEmptyComponent={ReviewEmpty}
      ListFooterComponent={truncated ? ReviewTruncated : null}
      recycleItems
      renderItem={renderReviewRow}
      style={styles.root}
    />
  );
}

function renderReviewRow(value: LegendListRenderItemProps<RenderableReviewRow>): React.JSX.Element {
  const { item } = value;
  if (item.kind === "line") {
    return (
      <ReviewLineView
        line={item.line}
        onSelectAnchor={item.onSelectAnchor}
        selected={sameAnchor(item.line.anchor, item.selectedAnchor)}
        wrapLines={item.wrapLines}
      />
    );
  }
  return (
    <View style={styles.splitRow}>
      <View style={styles.splitCell}>
        {item.line.left === null ? null : (
          <ReviewLineView
            line={item.line.left}
            onSelectAnchor={item.onSelectAnchor}
            selected={sameAnchor(item.line.left.anchor, item.selectedAnchor)}
            wrapLines={item.wrapLines}
          />
        )}
      </View>
      <View style={styles.splitCell}>
        {item.line.right === null ? null : (
          <ReviewLineView
            line={item.line.right}
            onSelectAnchor={item.onSelectAnchor}
            selected={sameAnchor(item.line.right.anchor, item.selectedAnchor)}
            wrapLines={item.wrapLines}
          />
        )}
      </View>
    </View>
  );
}

function ReviewEmpty(): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <ProductText tone="muted">No source or diff is available for this file.</ProductText>
    </View>
  );
}

function ReviewTruncated(): React.JSX.Element {
  return (
    <View style={styles.warning}>
      <ProductText style={styles.warningText} tone="warning">
        The server truncated this diff. Review the visible range carefully.
      </ProductText>
    </View>
  );
}

function reviewRowKey(row: RenderableReviewRow): string {
  return row.key;
}

function reviewLineKey(line: ReviewDiffLine, index: number): string {
  return `${index}:${line.kind}:${line.oldLine ?? "none"}:${line.newLine ?? "none"}:${line.text}`;
}

function sameAnchor(left: ReviewLineAnchor | null, right: ReviewLineAnchor | null): boolean {
  return (
    left !== null &&
    right !== null &&
    left.path === right.path &&
    left.line === right.line &&
    left.side === right.side
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xl },
  empty: { alignItems: "center", justifyContent: "center", minHeight: 180, padding: spacing.md },
  root: { backgroundColor: colors.code, flex: 1 },
  splitCell: { flex: 1, minWidth: 0 },
  splitRow: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
  warning: { backgroundColor: colors.surface, margin: spacing.md, padding: spacing.sm },
  warningText: { ...typeScale.label },
});
