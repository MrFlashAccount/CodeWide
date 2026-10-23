import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, View } from "react-native";

import {
  PULL_REQUEST_CATEGORIES,
  type PullRequestCategory,
} from "../../../data/forgePullRequestContract";
import { useEvent } from "../../../react/useEvent";
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
 * Fixed repository selector plus independently scrolling category tabs. The
 * repository control never moves when the category strip scrolls.
 */
export function CategoryChips({
  category,
  counts,
  onOpenRepositories,
  onSelect,
  pending,
  repository,
  supported,
}: {
  readonly category: PullRequestCategory;
  /** Row count of the loaded category; other categories show no number. */
  readonly counts: Partial<Readonly<Record<PullRequestCategory, number>>>;
  readonly onOpenRepositories: () => void;
  readonly onSelect: (category: PullRequestCategory) => void;
  readonly pending: { readonly category: boolean; readonly repository: boolean };
  readonly repository: string | null;
  readonly supported: ReadonlySet<PullRequestCategory>;
}): React.JSX.Element {
  return (
    <View style={styles.filters} testID="pull-request-category-chips">
      <Pressable
        accessibilityLabel={`Repository filter: ${repository ?? "All repos"}`}
        accessibilityRole="button"
        accessibilityState={{ busy: pending.repository }}
        hitSlop={controlHitSlop.compact}
        onPress={onOpenRepositories}
        style={styles.repositoryFilter}
        testID="pull-request-repository-filter"
      >
        <Ionicons color={colors.textMuted} name="git-branch-outline" size={iconSize.indicator} />
        <Text numberOfLines={1} shimmering={pending.repository} style={styles.repositoryLabel}>
          {repository ?? "All repos"}
        </Text>
        <Ionicons color={colors.textMuted} name="chevron-down" size={iconSize.indicator} />
      </Pressable>
      <ScrollView
        contentContainerStyle={styles.categoryChips}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.categoryStrip}
        testID="pull-request-category-strip"
      >
        {PULL_REQUEST_CATEGORIES.map((value) =>
          supported.has(value) ? (
            <CategoryChip
              count={counts[value]}
              key={value}
              onSelect={onSelect}
              pending={pending.category && value === category}
              selected={value === category}
              value={value}
            />
          ) : null,
        )}
      </ScrollView>
    </View>
  );
}

function CategoryChip({
  count,
  onSelect,
  pending,
  selected,
  value,
}: {
  readonly count: number | undefined;
  readonly onSelect: (category: PullRequestCategory) => void;
  readonly pending: boolean;
  readonly selected: boolean;
  readonly value: PullRequestCategory;
}): React.JSX.Element {
  const handlePress = useEvent((): void => {
    onSelect(value);
  });
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ busy: pending, selected }}
      hitSlop={controlHitSlop.compact}
      onPress={handlePress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text numberOfLines={1} shimmering={pending} style={styles.chipLabel}>
        {count === undefined || count === 0
          ? CATEGORY_LABELS[value]
          : `${CATEGORY_LABELS[value]} ${String(count)}`}
      </Text>
    </Pressable>
  );
}
