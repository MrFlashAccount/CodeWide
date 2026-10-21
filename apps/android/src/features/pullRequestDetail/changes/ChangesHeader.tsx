import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";

type ChangesView = "files" | "guide";

const VIEWS: readonly ChangesView[] = ["files", "guide"];
const LABELS: Readonly<Record<ChangesView, string>> = { files: "Files", guide: "Guide" };

/** Files | Guide switch over the same diff, with the viewed summary. */
export function ChangesHeader({
  onSelect,
  summary,
  view,
}: {
  readonly onSelect: (view: ChangesView) => void;
  readonly summary: string;
  readonly view: ChangesView;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      <View accessibilityRole="tablist" style={styles.segments}>
        {VIEWS.map((value) => (
          <ViewSegment key={value} onSelect={onSelect} selected={value === view} value={value} />
        ))}
      </View>
      <Text numberOfLines={1} style={styles.summary}>
        {summary}
      </Text>
    </View>
  );
}

function ViewSegment({
  onSelect,
  selected,
  value,
}: {
  readonly onSelect: (view: ChangesView) => void;
  readonly selected: boolean;
  readonly value: ChangesView;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={() => {
        onSelect(value);
      }}
      style={[styles.segment, selected && styles.selected]}
      testID={`changes-view-${value}`}
    >
      <Text numberOfLines={1} style={styles.label}>
        {selected ? `✓ ${LABELS[value]}` : LABELS[value]}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.label,
    color: colors.text,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  segment: {
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  segments: {
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    overflow: "hidden",
  },
  selected: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  summary: {
    ...typeScale.label,
    color: colors.textMuted,
    flex: 1,
    textAlign: "right",
  },
});
