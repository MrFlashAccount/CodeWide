import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView } from "react-native";

import {
  PULL_REQUEST_CATEGORIES,
  type PullRequestCategory,
} from "../../../data/forgePullRequestContract";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";

/** Exact chip copy (UI copy inventory). */
const CATEGORY_LABELS: Readonly<Record<PullRequestCategory, string>> = {
  assigned: "Assigned",
  authored: "Mine",
  drafts: "Drafts",
  mentioned: "Mentioned",
  reviewRequested: "Review requested",
};

/**
 * Single-line, horizontally scrolling filter row: repository filter first,
 * then the categories at least one account supports. Never wraps.
 */
export function CategoryChips({
  category,
  counts,
  onOpenRepositories,
  onSelect,
  repository,
  supported,
}: {
  readonly category: PullRequestCategory;
  /** Row count of the loaded category; other categories show no number. */
  readonly counts: Partial<Readonly<Record<PullRequestCategory, number>>>;
  readonly onOpenRepositories: () => void;
  readonly onSelect: (category: PullRequestCategory) => void;
  readonly repository: string | null;
  readonly supported: ReadonlySet<PullRequestCategory>;
}): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.chips}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.chipStrip}
      testID="pull-request-category-chips"
    >
      <Pressable
        accessibilityLabel={`Repository filter: ${repository ?? "All repos"}`}
        accessibilityRole="button"
        hitSlop={controlHitSlop.compact}
        onPress={onOpenRepositories}
        style={styles.chip}
      >
        <Text numberOfLines={1} style={styles.chipLabel}>
          {repository ?? "All repos"}
        </Text>
        <Ionicons color={colors.textMuted} name="chevron-down" size={iconSize.indicator} />
      </Pressable>
      {PULL_REQUEST_CATEGORIES.map((value) =>
        supported.has(value) ? (
          <CategoryChip
            count={counts[value]}
            key={value}
            onSelect={onSelect}
            selected={value === category}
            value={value}
          />
        ) : null,
      )}
    </ScrollView>
  );
}

function CategoryChip({
  count,
  onSelect,
  selected,
  value,
}: {
  readonly count: number | undefined;
  readonly onSelect: (category: PullRequestCategory) => void;
  readonly selected: boolean;
  readonly value: PullRequestCategory;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      hitSlop={controlHitSlop.compact}
      onPress={() => {
        onSelect(value);
      }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text numberOfLines={1} style={styles.chipLabel}>
        {count === undefined || count === 0
          ? CATEGORY_LABELS[value]
          : `${CATEGORY_LABELS[value]} ${String(count)}`}
      </Text>
    </Pressable>
  );
}
