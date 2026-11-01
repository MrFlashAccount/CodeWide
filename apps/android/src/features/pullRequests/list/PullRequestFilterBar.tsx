import { View } from "react-native";

import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { CatalogSearchRow } from "../../../presentation/input/CatalogSearchRow";
import { SearchOverlayHeader } from "../../../presentation/input/SearchOverlayHeader";
import { ThreadListHeaderAction } from "../../../presentation/navigation/ThreadListHeader";
import { useEvent } from "../../../react/useEvent";
import { ActionMenu, type ActionMenuItem } from "../../../ui/ActionMenu";
import {
  activePullRequestFilterCount,
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
  onSort,
}: {
  readonly filter: PullRequestSearchFilter;
  readonly onOpenFilters: () => void;
  readonly onOpenSearch: () => void;
  readonly onSort: (sort: PullRequestSearchFilter["query"]["sort"]) => void;
}): React.JSX.Element {
  const activeCount = activePullRequestFilterCount(filter);
  return (
    <View style={styles.filterHeader} testID="pull-request-filter-header">
      <SearchControls
        activeCount={activeCount}
        onOpenFilters={onOpenFilters}
        onOpenSearch={onOpenSearch}
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
  onSort,
  sort,
}: {
  readonly activeCount: number;
  readonly onOpenFilters: () => void;
  readonly onOpenSearch: () => void;
  readonly onSort: (sort: PullRequestSearchFilter["query"]["sort"]) => void;
  readonly sort: PullRequestSearchFilter["query"]["sort"];
}): React.JSX.Element {
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

/** Search-mode header shared with Threads; PR filters remain available, sorting stays outside. */
export function PullRequestSearchHeader({
  activeCount,
  close,
  draft,
  onOpenFilters,
  onSearch,
}: {
  readonly activeCount: number;
  readonly close: () => void;
  readonly draft: string;
  readonly onOpenFilters: () => void;
  readonly onSearch: (text: string) => void;
}): React.JSX.Element {
  const changeSearch = useEvent((text: string): void => {
    updatePullRequestSearchDraft(text);
    if (text === "") {
      onSearch("");
    }
  });
  const submitSearch = useEvent((): void => {
    onSearch(draft);
  });
  return (
    <SearchOverlayHeader
      accessibilityLabel="Search pull requests"
      backAccessibilityLabel="Back to pull requests"
      fieldTestID="pull-request-search-input"
      focusOnMount
      onBack={close}
      onChangeText={changeSearch}
      onSubmit={submitSearch}
      placeholder="Search pull requests"
      testID="pull-request-search-header"
      trailing={<FilterButton activeCount={activeCount} onPress={onOpenFilters} />}
      value={draft}
    />
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
