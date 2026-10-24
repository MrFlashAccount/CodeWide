import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, View } from "react-native";

import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { CatalogSearchRow } from "../../../presentation/input/CatalogSearchRow";
import { ThreadListHeaderAction } from "../../../presentation/navigation/ThreadListHeader";
import { useEvent } from "../../../react/useEvent";
import { colors, controlHitSlop, iconSize } from "../../../theme";
import { ActionMenu, type ActionMenuItem } from "../../../ui/ActionMenu";
import { AppTextInput as TextInput } from "../../../ui/Typography";
import {
  activePullRequestFilterCount,
  closePullRequestSearch,
  pullRequestSearchModel,
  updatePullRequestSearchDraft,
} from "../pullRequestListModel";
import { listStyles as styles } from "./list.styles";

const SORT_OPTIONS = [
  {
    direction: "descending",
    field: "updated",
    id: "updated:descending",
    label: "Recently updated",
  },
  {
    direction: "ascending",
    field: "updated",
    id: "updated:ascending",
    label: "Least recently updated",
  },
  {
    direction: "descending",
    field: "created",
    id: "created:descending",
    label: "Newest created",
  },
  {
    direction: "ascending",
    field: "created",
    id: "created:ascending",
    label: "Oldest created",
  },
] as const;

/** Search, sort and the structured-filter entry. */
export function PullRequestFilterBar({
  filter,
  onOpenFilters,
  onOpenSearch,
  onSearch,
  onSort,
}: {
  readonly filter: PullRequestSearchFilter;
  readonly onOpenFilters: () => void;
  readonly onOpenSearch: () => void;
  readonly onSearch: (text: string) => void;
  readonly onSort: (sort: PullRequestSearchFilter["query"]["sort"]) => void;
}): React.JSX.Element {
  const activeCount = activePullRequestFilterCount(filter);
  return (
    <View style={styles.filterHeader} testID="pull-request-filter-header">
      <SearchControls
        activeCount={activeCount}
        onOpenFilters={onOpenFilters}
        onOpenSearch={onOpenSearch}
        onSearch={onSearch}
        onSort={onSort}
        sort={filter.query.sort}
      />
    </View>
  );
}

function SearchControls({
  activeCount,
  onOpenFilters,
  onOpenSearch,
  onSearch,
  onSort,
  sort,
}: {
  readonly activeCount: number;
  readonly onOpenFilters: () => void;
  readonly onOpenSearch: () => void;
  readonly onSearch: (text: string) => void;
  readonly onSort: (sort: PullRequestSearchFilter["query"]["sort"]) => void;
  readonly sort: PullRequestSearchFilter["query"]["sort"];
}): React.JSX.Element {
  const search = useSelector(() => pullRequestSearchModel.get());
  if (!search.open) {
    return (
      <CatalogSearchRow
        accessibilityLabel="Search pull requests"
        actions={
          <>
            <PullRequestSortMenu onSort={onSort} sort={sort} />
            <FilterButton activeCount={activeCount} onPress={onOpenFilters} />
          </>
        }
        onOpenSearch={onOpenSearch}
        placeholder="Search pull requests"
        testID="pull-request-search-row"
      />
    );
  }
  return (
    <View style={styles.searchRow}>
      <ThreadListHeaderAction
        accessibilityLabel="Close pull request search"
        name="arrow-back"
        onPress={closePullRequestSearch}
      />
      <PullRequestSearchInput draft={search.draft} onSearch={onSearch} />
      <PullRequestSortMenu onSort={onSort} sort={sort} />
      <FilterButton activeCount={activeCount} onPress={onOpenFilters} />
    </View>
  );
}

function PullRequestSearchInput({
  draft,
  onSearch,
}: {
  readonly draft: string;
  readonly onSearch: (text: string) => void;
}): React.JSX.Element {
  const submitSearch = useEvent((event: { readonly nativeEvent: { readonly text: string } }) => {
    onSearch(event.nativeEvent.text);
  });
  const clearSearch = useEvent(() => {
    updatePullRequestSearchDraft("");
    onSearch("");
  });
  return (
    <View style={styles.searchField}>
      <Ionicons color={colors.textMuted} name="search" size={iconSize.inline} />
      <TextInput
        accessibilityLabel="Search pull requests"
        autoCapitalize="none"
        autoCorrect={false}
        compact
        onChangeText={updatePullRequestSearchDraft}
        onSubmitEditing={submitSearch}
        placeholder="Search pull requests"
        placeholderTextColor={colors.textDim}
        returnKeyType="search"
        style={styles.searchInput}
        testID="pull-request-search-input"
        value={draft}
      />
      {draft === "" ? null : (
        <Pressable
          accessibilityLabel="Clear pull request search"
          accessibilityRole="button"
          hitSlop={controlHitSlop.regular}
          onPress={clearSearch}
        >
          <Ionicons color={colors.textMuted} name="close" size={iconSize.action} />
        </Pressable>
      )}
    </View>
  );
}

function PullRequestSortMenu({
  onSort,
  sort,
}: {
  readonly onSort: (sort: PullRequestSearchFilter["query"]["sort"]) => void;
  readonly sort: PullRequestSearchFilter["query"]["sort"];
}): React.JSX.Element {
  const actions: readonly ActionMenuItem[] = SORT_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    selected: option.field === sort.field && option.direction === sort.direction,
  }));
  const select = useEvent((id: string): void => {
    const option = SORT_OPTIONS.find((candidate) => candidate.id === id);
    if (option !== undefined) {
      onSort({ direction: option.direction, field: option.field });
    }
  });
  return (
    <ActionMenu
      accessibilityLabel="Sort pull requests"
      actions={actions}
      align="end"
      onSelect={select}
      placement="bottom"
    >
      <ThreadListHeaderAction accessibilityLabel="Sort pull requests" name="swap-vertical" />
    </ActionMenu>
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
    <ThreadListHeaderAction
      accessibilityLabel={`Filters${activeCount === 0 ? "" : `, ${String(activeCount)} active`}`}
      accessibilityState={{ selected: activeCount > 0 }}
      name={activeCount > 0 ? "filter" : "filter-outline"}
      onPress={onPress}
    >
      {activeCount > 0 ? <View style={styles.filterDot} /> : null}
    </ThreadListHeaderAction>
  );
}
