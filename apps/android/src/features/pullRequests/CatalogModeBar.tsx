import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, iconSize, layoutSize, radii, spacing, typeScale } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Material 3 navigation-bar active indicator width. */
const ACTIVE_INDICATOR_WIDTH = 56;

/** Which catalog the bottom bar shows. */
export type CatalogMode = "pullRequests" | "threads";

/**
 * Always-mounted bottom bar of the catalog pane (never inside the PR screen).
 * Selecting a mode is a route `replace`, owned by route composition. The PR
 * count is the review-requested count and is hidden when it is zero.
 */
export function CatalogModeBar({
  mode,
  onSelect,
  reviewRequestedCount,
}: {
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
  readonly reviewRequestedCount: number;
}): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={styles.bar} testID="catalog-mode-bar">
      <ModeTab
        icon="chatbubbles-outline"
        label="Threads"
        mode="threads"
        onSelect={onSelect}
        selected={mode === "threads"}
      />
      <ModeTab
        icon="git-pull-request-outline"
        label={
          reviewRequestedCount > 0
            ? `Pull requests ${String(reviewRequestedCount)}`
            : "Pull requests"
        }
        mode="pullRequests"
        onSelect={onSelect}
        selected={mode === "pullRequests"}
      />
    </View>
  );
}

function ModeTab({
  icon,
  label,
  mode,
  onSelect,
  selected,
}: {
  readonly icon: React.ComponentProps<typeof Ionicons>["name"];
  readonly label: string;
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
  readonly selected: boolean;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={() => {
        if (!selected) {
          onSelect(mode);
        }
      }}
      style={styles.tab}
      testID={`catalog-mode-${mode}`}
    >
      <View style={[styles.indicator, selected && styles.indicatorSelected]}>
        <Ionicons
          color={selected ? colors.text : colors.textMuted}
          name={icon}
          size={iconSize.action}
        />
      </View>
      <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.threadListSurface,
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingBottom: spacing.xxs,
    paddingTop: spacing.xs,
  },
  indicator: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: controlSize.compact,
    justifyContent: "center",
    width: ACTIVE_INDICATOR_WIDTH,
  },
  indicatorSelected: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  labelSelected: {
    color: colors.text,
  },
  tab: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xxs,
    justifyContent: "center",
    minHeight: layoutSize.header,
  },
});
