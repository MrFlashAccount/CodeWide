import { Pressable, StyleSheet, View } from "react-native";

import { colors, controlSize, spacing, typeScale, typeWeight } from "../../theme";
import { CaptionBadge } from "../../ui/CaptionBadge";
import { AppText as Text } from "../../ui/Typography";
import type { PullRequestTab } from "./pullRequestScreenModel";

/** Height of the selected tab's underline indicator. */
const TAB_INDICATOR_HEIGHT = 2;

/** Details | Changes; the Changes tab carries the draft count. Labels never wrap. */
export function PullRequestTabs({
  draftCount,
  onSelect,
  tab,
}: {
  readonly draftCount: number;
  readonly onSelect: (tab: PullRequestTab) => void;
  readonly tab: PullRequestTab;
}): React.JSX.Element {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      <Tab label="Details" onSelect={onSelect} selected={tab === "overview"} value="overview" />
      <Tab
        badge={
          draftCount === 0 ? null : `${String(draftCount)} ${draftCount === 1 ? "draft" : "drafts"}`
        }
        label="Changes"
        onSelect={onSelect}
        selected={tab === "changes"}
        value="changes"
      />
    </View>
  );
}

function Tab({
  badge = null,
  label,
  onSelect,
  selected,
  value,
}: {
  readonly badge?: string | null;
  readonly label: string;
  readonly onSelect: (tab: PullRequestTab) => void;
  readonly selected: boolean;
  readonly value: PullRequestTab;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={badge === null ? label : `${label}, ${badge}`}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={() => {
        onSelect(value);
      }}
      style={[styles.tab, selected && styles.selected]}
      testID={`pull-request-tab-${value}`}
    >
      <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
        {label}
      </Text>
      {badge === null ? null : <CaptionBadge label={badge} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  labelSelected: {
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  selected: {
    borderBottomColor: colors.primary,
  },
  tab: {
    alignItems: "center",
    borderBottomColor: "transparent",
    borderBottomWidth: TAB_INDICATOR_HEIGHT,
    columnGap: spacing.xs,
    flex: 1,
    flexDirection: "row",
    justifyContent: "center",
    minHeight: controlSize.touch,
  },
  tabs: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
  },
});
