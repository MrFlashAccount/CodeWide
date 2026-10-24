import { LegendList } from "@legendapp/list/react-native";
import { View } from "react-native";

import type { AccountState, ForgeProvider, ProviderIcon } from "../../../data/forgeContract";
import type {
  PullRequestListPage,
  PullRequestRow as Row,
} from "../../../data/forgePullRequestContract";
import { remoteValue, type RemoteValue } from "../../../data/forgeRemoteValue";
import { layoutSize } from "../../../theme";
import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { listStyles as styles } from "./list.styles";
import { ListSkeleton } from "./ListSkeleton";
import { ListNotice } from "./ListNotice";
import { pullRequestListItems } from "./pullRequestListItems";
import { PullRequestListItemView } from "./PullRequestListItemView";
import { PullRequestFilterBar } from "./PullRequestFilterBar";
import { PullRequestFilterSheet } from "./PullRequestFilterSheet";

/**
 * PR list for one connection: filter chips, account sections and rows. The
 * last published page stays visible while a refresh runs; when the companion
 * is unreachable the stored snapshot is shown with its age (Q3).
 */
export function PullRequestList(props: {
  readonly accounts: readonly AccountState[];
  readonly filter: PullRequestSearchFilter;
  /** Provider mark of an account's plugin, from the accounts snapshot. */
  readonly iconFor: (pluginId: string) => ProviderIcon | null;
  readonly nowMs: number;
  readonly onCategory: (category: PullRequestListPage["category"]) => void;
  readonly onEndReached: () => void;
  readonly onOpen: (row: Row) => void;
  readonly onOpenFilters: () => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly onRetry: () => void;
  readonly onSearch: (text: string) => void;
  readonly pendingFilter: boolean;
  readonly providers: readonly ForgeProvider[];
  readonly state: RemoteValue<PullRequestListPage> | undefined;
}): React.JSX.Element {
  const { filter, state } = props;
  const page = remoteValue(state);
  const items = listItems(page);
  return (
    <View style={styles.fill} testID="pull-request-list">
      <PullRequestFilterBar
        count={page === null ? undefined : items.filter((item) => item.kind === "row").length}
        filter={filter}
        onCategory={props.onCategory}
        onOpenFilters={props.onOpenFilters}
        onSearch={props.onSearch}
        pending={props.pendingFilter}
      />
      <ListNotice nowMs={props.nowMs} state={visibleNoticeState(state, props.pendingFilter)} />
      <PullRequestRows items={items} page={page} props={props} />
      <PullRequestFilterSheet
        accounts={props.accounts}
        providers={props.providers}
        repositories={page?.repositories ?? []}
      />
    </View>
  );
}

function listItems(page: PullRequestListPage | null) {
  return page === null ? [] : pullRequestListItems(page);
}

function visibleNoticeState(
  state: RemoteValue<PullRequestListPage> | undefined,
  pending: boolean,
): RemoteValue<PullRequestListPage> | undefined {
  return pending ? undefined : state;
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
