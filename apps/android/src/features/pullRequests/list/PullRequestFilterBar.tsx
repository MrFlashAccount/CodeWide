import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import type { PullRequestCategory } from "../../../data/forgePullRequestContract";
import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { useEvent } from "../../../react/useEvent";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import {
  activePullRequestFilterCount,
  clearAppliedPullRequestFilter,
} from "../pullRequestListModel";
import { listStyles as styles } from "./list.styles";

const QUICK_VIEWS: readonly { readonly label: string; readonly value: PullRequestCategory }[] = [
  { label: "Review requested", value: "reviewRequested" },
  { label: "Mine", value: "authored" },
  { label: "Assigned", value: "assigned" },
  { label: "All", value: "all" },
];

type ClearableField = Parameters<typeof clearAppliedPullRequestFilter>[0];
type ActiveToken = { readonly field: ClearableField; readonly label: string };

/** Search, quick views and removable applied-filter tokens. */
export function PullRequestFilterBar({
  count,
  filter,
  onCategory,
  onOpenFilters,
  onSearch,
  pending,
}: {
  readonly count: number | undefined;
  readonly filter: PullRequestSearchFilter;
  readonly onCategory: (category: PullRequestCategory) => void;
  readonly onOpenFilters: () => void;
  readonly onSearch: (text: string) => void;
  readonly pending: boolean;
}): React.JSX.Element {
  const activeCount = activePullRequestFilterCount(filter);
  const tokens = activeTokens(filter);
  return (
    <View style={styles.filterHeader} testID="pull-request-filter-header">
      <SearchControls
        activeCount={activeCount}
        onOpenFilters={onOpenFilters}
        onSearch={onSearch}
        text={filter.query.text}
      />
      <ScrollView
        contentContainerStyle={styles.quickViews}
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        testID="pull-request-quick-views"
      >
        {QUICK_VIEWS.map((view) => (
          <QuickView
            count={view.value === filter.query.category ? count : undefined}
            key={view.value}
            onSelect={onCategory}
            pending={pending && view.value === filter.query.category}
            selected={view.value === filter.query.category}
            view={view}
          />
        ))}
      </ScrollView>
      <ActiveTokensBar tokens={tokens} />
    </View>
  );
}

function SearchControls({
  activeCount,
  onOpenFilters,
  onSearch,
  text,
}: {
  readonly activeCount: number;
  readonly onOpenFilters: () => void;
  readonly onSearch: (text: string) => void;
  readonly text: string;
}): React.JSX.Element {
  const submitSearch = useEvent((event: { readonly nativeEvent: { readonly text: string } }) => {
    onSearch(event.nativeEvent.text);
  });
  return (
    <View style={styles.searchRow}>
      <View style={styles.searchField}>
        <Ionicons color={colors.textMuted} name="search-outline" size={iconSize.inline} />
        <TextInput
          accessibilityLabel="Search pull requests"
          autoCapitalize="none"
          autoCorrect={false}
          defaultValue={text}
          key={text}
          onSubmitEditing={submitSearch}
          placeholder="Search pull requests"
          placeholderTextColor={colors.textDim}
          returnKeyType="search"
          style={styles.searchInput}
          testID="pull-request-search"
        />
      </View>
      <FilterButton activeCount={activeCount} onPress={onOpenFilters} />
    </View>
  );
}

function FilterButton({
  activeCount,
  onPress,
}: {
  readonly activeCount: number;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={`Filters${activeCount === 0 ? "" : `, ${String(activeCount)} active`}`}
      accessibilityRole="button"
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [styles.filterButton, pressed && styles.pressed]}
      testID="pull-request-open-filters"
    >
      <Ionicons color={colors.text} name="options-outline" size={iconSize.action} />
      {activeCount > 0 ? <FilterCount count={activeCount} /> : null}
    </Pressable>
  );
}

function FilterCount({ count }: { readonly count: number }): React.JSX.Element {
  return (
    <View style={styles.filterCount}>
      <Text style={styles.filterCountText}>{String(count)}</Text>
    </View>
  );
}

function ActiveTokensBar({
  tokens,
}: {
  readonly tokens: readonly ActiveToken[];
}): React.JSX.Element | null {
  if (tokens.length === 0) {
    return null;
  }
  return (
    <ScrollView
      contentContainerStyle={styles.activeTokens}
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="pull-request-active-filters"
    >
      {tokens.map((token) => (
        <ActiveTokenView key={token.field} token={token} />
      ))}
    </ScrollView>
  );
}

function ActiveTokenView({ token }: { readonly token: ActiveToken }): React.JSX.Element {
  const clear = useEvent(() => {
    clearAppliedPullRequestFilter(token.field);
  });
  return (
    <Pressable
      accessibilityLabel={`Remove ${token.label} filter`}
      accessibilityRole="button"
      onPress={clear}
      style={styles.activeToken}
    >
      <Text numberOfLines={1} style={styles.activeTokenText}>
        {token.label}
      </Text>
      <Ionicons color={colors.textMuted} name="close" size={iconSize.indicator} />
    </Pressable>
  );
}

function QuickView({
  count,
  onSelect,
  pending,
  selected,
  view,
}: {
  readonly count: number | undefined;
  readonly onSelect: (category: PullRequestCategory) => void;
  readonly pending: boolean;
  readonly selected: boolean;
  readonly view: { readonly label: string; readonly value: PullRequestCategory };
}): React.JSX.Element {
  const select = useEvent(() => {
    onSelect(view.value);
  });
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ busy: pending, selected }}
      onPress={select}
      style={[styles.quickView, selected && styles.quickViewSelected]}
    >
      <Text
        shimmering={pending}
        style={[styles.quickViewText, selected && styles.quickViewTextSelected]}
      >
        {count === undefined ? view.label : `${view.label} ${String(count)}`}
      </Text>
    </Pressable>
  );
}

function activeTokens(filter: PullRequestSearchFilter): readonly ActiveToken[] {
  const tokens: ActiveToken[] = [];
  if (filter.providerIds.length > 0 || filter.accounts.length > 0) {
    tokens.push({ field: "sources", label: sourceLabel(filter) });
  }
  pushValuesToken({
    field: "repositories",
    label: "Repos",
    tokens,
    values: filter.query.repositories,
  });
  const people =
    tokenValueCount(filter.query.authors) +
    tokenValueCount(filter.query.assignees) +
    tokenValueCount(filter.query.reviewers);
  if (people > 0) {
    tokens.push({ field: "people", label: `People · ${String(people)}` });
  }
  pushValuesToken({ field: "review", label: "Review", tokens, values: filter.query.review });
  if (
    filter.query.states.exclude.length > 0 ||
    filter.query.states.include.length !== 1 ||
    filter.query.states.include[0] !== "open"
  ) {
    tokens.push({ field: "states", label: valuesLabel("State", filter.query.states) });
  }
  pushValuesToken({ field: "checks", label: "Checks", tokens, values: filter.query.checks });
  const metadata =
    tokenValueCount(filter.query.labels) +
    tokenValueCount(filter.query.baseBranches) +
    tokenValueCount(filter.query.headBranches);
  if (metadata > 0) {
    tokens.push({ field: "metadata", label: `Metadata · ${String(metadata)}` });
  }
  return tokens;
}

function sourceLabel(filter: PullRequestSearchFilter): string {
  const count = filter.accounts.length > 0 ? filter.accounts.length : filter.providerIds.length;
  return count === 1 ? "1 source" : `${String(count)} sources`;
}

function pushValuesToken<Value extends string>({
  field,
  label,
  tokens,
  values,
}: {
  readonly field: ClearableField;
  readonly label: string;
  readonly tokens: ActiveToken[];
  readonly values: { readonly exclude: readonly Value[]; readonly include: readonly Value[] };
}): void {
  if (values.include.length + values.exclude.length > 0) {
    tokens.push({ field, label: valuesLabel(label, values) });
  }
}

function valuesLabel<Value extends string>(
  label: string,
  values: { readonly exclude: readonly Value[]; readonly include: readonly Value[] },
): string {
  const [only] = values.include;
  if (only !== undefined && values.include.length === 1 && values.exclude.length === 0) {
    return `${label}: ${only}`;
  }
  return `${label} · ${String(values.include.length + values.exclude.length)}`;
}

function tokenValueCount(values: {
  readonly exclude: readonly string[];
  readonly include: readonly string[];
}): number {
  return values.include.length + values.exclude.length;
}
