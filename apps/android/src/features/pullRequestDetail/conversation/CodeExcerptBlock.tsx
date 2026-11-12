import { ScrollView, StyleSheet, View } from "react-native";

import type { CodeExcerpt, ThreadAnchor } from "../../../data/forgeConversationContract";
import { colors, radii, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { excerptLabel, excerptRows, type ExcerptRow } from "./codeExcerpt";

const ANCHOR_BAR_WIDTH = 3;
const GUTTER_WIDTH = 36;

/**
 * The code a thread is about, GitHub Mobile style: old and new line-number
 * gutters, the diff marker, added and removed rows tinted, and the anchored
 * lines marked by a bar. Lines never wrap; the block scrolls sideways.
 */
export function CodeExcerptBlock({
  anchor,
  excerpt,
  testID,
}: {
  readonly anchor: ThreadAnchor;
  readonly excerpt: CodeExcerpt;
  readonly testID: string;
}): React.JSX.Element {
  const rows = excerptRows(excerpt, anchor);
  return (
    <View
      accessibilityLabel={excerptLabel(excerpt, anchor)}
      accessible
      style={styles.block}
      testID={testID}
    >
      <ScrollView
        contentContainerStyle={styles.rows}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        {rows.map((row, index) => (
          <Row
            key={`${row.oldLabel}:${row.newLabel}`}
            row={row}
            testID={`${testID}-line-${String(index)}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Row({
  row,
  testID,
}: {
  readonly row: ExcerptRow;
  readonly testID: string;
}): React.JSX.Element {
  return (
    <View
      style={[styles.row, TINTS[row.kind], row.anchored && styles.anchored]}
      testID={row.anchored ? `${testID}-anchored` : testID}
    >
      <Text style={styles.gutter}>{row.oldLabel}</Text>
      <Text style={styles.gutter}>{row.newLabel}</Text>
      <Text style={styles.code}>{`${row.marker} ${row.text}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  added: {
    backgroundColor: colors.successContainer,
  },
  anchored: {
    borderLeftColor: colors.warning,
  },
  block: {
    backgroundColor: colors.code,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  code: {
    ...typeScale.code,
    color: colors.text,
    paddingRight: spacing.sm,
  },
  context: {},
  gutter: {
    ...typeScale.code,
    color: colors.textDim,
    paddingRight: spacing.xxs,
    textAlign: "right",
    width: GUTTER_WIDTH,
  },
  removed: {
    backgroundColor: colors.errorContainer,
  },
  row: {
    borderLeftColor: "transparent",
    borderLeftWidth: ANCHOR_BAR_WIDTH,
    flexDirection: "row",
    minWidth: "100%",
  },
  rows: {
    flexDirection: "column",
    minWidth: "100%",
    paddingVertical: spacing.xxs,
  },
});

const TINTS = { added: styles.added, context: styles.context, removed: styles.removed } as const;
