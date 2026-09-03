import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale } from "../../theme";
import type { ReviewDiffLine, ReviewLineAnchor } from "../../rendering/review/reviewModel";
import { ProductText } from "../text/ProductText";

interface ReviewLineViewProps {
  line: ReviewDiffLine;
  onSelectAnchor(anchor: ReviewLineAnchor): void;
  selected: boolean;
  wrapLines: boolean;
}

export function ReviewLineView(props: ReviewLineViewProps): React.JSX.Element {
  const { line, onSelectAnchor, selected, wrapLines } = props;
  const select = useEvent(() => {
    if (line.anchor !== null) onSelectAnchor(line.anchor);
  });
  const content = (
    <View style={[styles.row, lineStyle(line.kind), selected && styles.selected]}>
      <ProductText style={styles.lineNumber} tone="dim">
        {line.oldLine ?? ""}
      </ProductText>
      <ProductText style={styles.lineNumber} tone="dim">
        {line.newLine ?? ""}
      </ProductText>
      <ProductText
        numberOfLines={wrapLines ? undefined : 1}
        selectable={line.anchor === null}
        style={styles.code}
      >
        {line.text === "" ? " " : line.text}
      </ProductText>
    </View>
  );
  if (line.anchor === null) return content;
  return (
    <Pressable accessibilityLabel={anchorLabel(line.anchor)} onPress={select}>
      {content}
    </Pressable>
  );
}

function anchorLabel(anchor: ReviewLineAnchor): string {
  return `Comment on ${anchor.side} line ${anchor.line} of ${anchor.path}`;
}

function lineStyle(kind: ReviewDiffLine["kind"]): ViewStyle | null {
  if (kind === "added") return styles.added;
  if (kind === "deleted") return styles.deleted;
  if (kind === "header") return styles.header;
  return null;
}

const styles = StyleSheet.create({
  added: { backgroundColor: colors.successContainer },
  code: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    ...typeScale.code,
  },
  deleted: { backgroundColor: colors.errorContainer },
  header: { backgroundColor: colors.surface },
  lineNumber: {
    minWidth: 38,
    paddingHorizontal: spacing.optical,
    textAlign: "right",
    ...typeScale.caption,
  },
  row: {
    alignItems: "flex-start",
    flexDirection: "row",
    minHeight: 24,
    paddingVertical: spacing.optical,
  },
  selected: { borderColor: colors.accent, borderWidth: 1 },
});
