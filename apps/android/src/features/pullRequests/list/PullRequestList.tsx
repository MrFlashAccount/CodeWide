import { LegendList } from "@legendapp/list/react-native";
import { useState } from "react";
import { View } from "react-native";

import type { AccountState, ProviderIcon } from "../../../data/forgeContract";
import type {
  PullRequestListPage,
  PullRequestRow as Row,
} from "../../../data/forgePullRequestContract";
import { remoteValue, type RemoteValue } from "../../../data/forgeRemoteValue";
import { useEvent } from "../../../react/useEvent";
import { layoutSize } from "../../../theme";
import type { PullRequestListFilter } from "../pullRequestListModel";
import { CategoryChips } from "./CategoryChips";
import { listStyles as styles } from "./list.styles";
import { ListSkeleton } from "./ListSkeleton";
import { ListNotice } from "./ListNotice";
import { pullRequestListItems, supportedCategories } from "./pullRequestListItems";
import { PullRequestListItemView } from "./PullRequestListItemView";
import { RepositoryFilterSheet } from "./RepositoryFilterSheet";

/**
 * PR list for one connection: filter chips, account sections and rows. The
 * last published page stays visible while a refresh runs; when the companion
 * is unreachable the stored snapshot is shown with its age (Q3).
 */
export function PullRequestList(props: {
  readonly filter: PullRequestListFilter;
  /** Provider mark of an account's plugin, from the accounts snapshot. */
  readonly iconFor: (pluginId: string) => ProviderIcon | null;
  readonly nowMs: number;
  readonly onCategory: (category: PullRequestListFilter["category"]) => void;
  readonly onEndReached: () => void;
  readonly onOpen: (row: Row) => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly onRepository: (repository: string | null) => void;
  readonly onRetry: () => void;
  readonly pendingFilter: { readonly category: boolean; readonly repository: boolean };
  readonly state: RemoteValue<PullRequestListPage> | undefined;
}): React.JSX.Element {
  const { filter, state } = props;
  const [repositoriesOpen, setRepositoriesOpen] = useState(false);
  const page = remoteValue(state);
  const items = listItems(page);
  const openRepositories = useEvent((): void => {
    setRepositoriesOpen(true);
  });
  const closeRepositories = useEvent((): void => {
    setRepositoriesOpen(false);
  });
  return (
    <View style={styles.fill} testID="pull-request-list">
      <CategoryChips
        category={filter.category}
        counts={categoryCounts(page, items)}
        onOpenRepositories={openRepositories}
        onSelect={props.onCategory}
        pending={props.pendingFilter}
        repository={filter.repository}
        supported={supportedCategories(page)}
      />
      <ListNotice nowMs={props.nowMs} state={visibleNoticeState(state, props.pendingFilter)} />
      <PullRequestRows items={items} page={page} props={props} />
      <RepositoryFilterSheet
        onDismiss={closeRepositories}
        onSelect={props.onRepository}
        open={repositoriesOpen}
        repositories={page?.repositories ?? []}
        selected={filter.repository}
      />
    </View>
  );
}

function listItems(page: PullRequestListPage | null) {
  return page === null ? [] : pullRequestListItems(page);
}

function categoryCounts(
  page: PullRequestListPage | null,
  items: ReturnType<typeof pullRequestListItems>,
): Partial<Readonly<Record<PullRequestListFilter["category"], number>>> {
  return page === null
    ? {}
    : { [page.category]: items.filter((item) => item.kind === "row").length };
}

function visibleNoticeState(
  state: RemoteValue<PullRequestListPage> | undefined,
  pending: { readonly category: boolean; readonly repository: boolean },
): RemoteValue<PullRequestListPage> | undefined {
  return pending.category || pending.repository ? undefined : state;
}

function PullRequestRows({
  items,
  page,
  props,
}: {
  readonly items: ReturnType<typeof pullRequestListItems>;
  readonly page: PullRequestListPage | null;
  readonly props: Parameters<typeof PullRequestList>[0];
}): React.JSX.Element {
  if (page === null) {
    return <ListSkeleton />;
  }
  return (
    <LegendList
      contentContainerStyle={styles.floatingBarContent}
      data={items}
      estimatedItemSize={layoutSize.row}
      getItemType={(item) => item.kind}
      keyExtractor={(item) => item.key}
      onEndReached={props.onEndReached}
      onEndReachedThreshold={0.4}
      recycleItems
      renderItem={({ item }) => (
        <PullRequestListItemView
          iconFor={props.iconFor}
          item={item}
          nowMs={props.nowMs}
          onOpen={props.onOpen}
          onReconnect={props.onReconnect}
          onRetry={props.onRetry}
        />
      )}
    />
  );
}
