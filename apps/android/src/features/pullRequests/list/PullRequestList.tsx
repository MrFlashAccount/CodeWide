import { LegendList } from "@legendapp/list/react-native";
import { useState } from "react";
import { View } from "react-native";

import type { AccountState, ProviderIcon } from "../../../data/forgeContract";
import type {
  PullRequestListPage,
  PullRequestRow as Row,
} from "../../../data/forgePullRequestContract";
import { remoteValue, type RemoteValue } from "../../../data/forgeRemoteValue";
import { layoutSize } from "../../../theme";
import type { PullRequestListFilter } from "../pullRequestListModel";
import { CategoryChips } from "./CategoryChips";
import { listStyles as styles } from "./list.styles";
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
  /** PR whose overview is preloading for navigation. */
  readonly openingKey: string | null;
  readonly state: RemoteValue<PullRequestListPage> | undefined;
}): React.JSX.Element {
  const { filter, state } = props;
  const [repositoriesOpen, setRepositoriesOpen] = useState(false);
  const page = remoteValue(state);
  const items = page === null ? [] : pullRequestListItems(page);
  return (
    <View style={styles.fill} testID="pull-request-list">
      <CategoryChips
        category={filter.category}
        counts={
          page === null
            ? {}
            : { [page.category]: items.filter((item) => item.kind === "row").length }
        }
        onOpenRepositories={() => {
          setRepositoriesOpen(true);
        }}
        onSelect={props.onCategory}
        repository={filter.repository}
        supported={supportedCategories(page)}
      />
      <ListNotice nowMs={props.nowMs} state={state} />
      <LegendList
        contentContainerStyle={styles.floatingBarContent}
        data={items}
        dataKey={`pull-requests:${filter.category}:${filter.repository ?? ""}`}
        estimatedItemSize={layoutSize.row}
        extraData={props.openingKey}
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
            openingKey={props.openingKey}
          />
        )}
      />
      <RepositoryFilterSheet
        onDismiss={() => {
          setRepositoriesOpen(false);
        }}
        onSelect={props.onRepository}
        open={repositoriesOpen}
        repositories={page?.repositories ?? []}
        selected={filter.repository}
      />
    </View>
  );
}
