import { ScrollView } from "react-native";

import type { PullRequestCategory } from "../../../data/forgePullRequestContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { controlHitSlop } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { listStyles as styles } from "./list.styles";
import type { PullRequestCategoryOption } from "./pullRequestCategories";

/**
 * Single-select category row under catalog search. A tap applies at once,
 * independently from the filter tray's draft.
 */
export function PullRequestCategoryChips({
  onSelect,
  options,
  selected,
}: {
  readonly onSelect: (category: PullRequestCategory) => void;
  readonly options: readonly PullRequestCategoryOption[];
  readonly selected: PullRequestCategory;
}): React.JSX.Element | null {
  if (options.length === 0) {
    return null;
  }
  return (
    <ScrollView
      accessibilityLabel="Pull request category"
      contentContainerStyle={styles.categoryChips}
      horizontal
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.categoryViewport}
      testID="pull-request-category-chips"
    >
      {options.map((option) => {
        const active = option.category === selected;
        return (
          <AppButton
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            hitSlop={controlHitSlop.compact}
            key={option.category}
            onPress={() => {
              if (!active) {
                onSelect(option.category);
              }
            }}
            size="sm"
            style={[styles.categoryChip, !active && styles.categoryChipInactive]}
            variant={active ? "primary" : "secondary"}
          >
            <Text
              numberOfLines={1}
              style={[styles.categoryChipLabel, active && styles.categoryChipLabelActive]}
            >
              {option.label}
            </Text>
          </AppButton>
        );
      })}
    </ScrollView>
  );
}
