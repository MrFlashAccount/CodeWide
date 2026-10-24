import { LegendList } from "@legendapp/list/react-native";
import { Animated, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";

import type { AccountState, ForgeProvider, ProviderIcon } from "../../../data/forgeContract";
import type {
  PullRequestListPage,
  PullRequestRow as Row,
} from "../../../data/forgePullRequestContract";
import { remoteValue, type RemoteValue } from "../../../data/forgeRemoteValue";
import { useCatalogSearchPullGesture } from "../../../presentation/input/catalogSearchPullModel";
import { CatalogSearchPullProvider } from "../../../presentation/input/CatalogSearchPullProvider";
import { CatalogSearchPullBackdrop } from "../../../presentation/input/CatalogSearchPullBackdrop";
import { layoutSize } from "../../../theme";
import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { listStyles as styles } from "./list.styles";
import { ListSkeleton } from "./ListSkeleton";
import { ListNotice } from "./ListNotice";
import { PullRequestEmptyState } from "./PullRequestEmptyState";
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
  readonly onEndReached: () => void;
  readonly onOpen: (row: Row) => void;
  readonly onOpenFilters: () => void;
  readonly onOpenSearch: () => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly onRetry: () => void;
  readonly onSearch: (text: string) => void;
  readonly onSort: (sort: PullRequestSearchFilter["query"]["sort"]) => void;
  readonly pendingFilter: boolean;
  readonly providers: readonly ForgeProvider[];
  readonly state: RemoteValue<PullRequestListPage> | undefined;
}): React.JSX.Element {
  return (
    <CatalogSearchPullProvider>
      <PullRequestListSurface {...props} />
    </CatalogSearchPullProvider>
  );
}

function PullRequestListSurface(props: Parameters<typeof PullRequestList>[0]): React.JSX.Element {
  const { filter, state } = props;
  const page = remoteValue(state);
  const items = listItems(page);
  return (
    <View style={styles.fill} testID="pull-request-list">
      <PullRequestFilterBar
        filter={filter}
        onOpenFilters={props.onOpenFilters}
        onOpenSearch={props.onOpenSearch}
        onSearch={props.onSearch}
        onSort={props.onSort}
      />
      <ListNotice nowMs={props.nowMs} state={visibleNoticeState(state, props.pendingFilter)} />
      <View style={styles.fill}>
        <PullRequestRows items={items} page={page} props={props} />
        <CatalogSearchPullBackdrop testID="pull-request-list-pull-backdrop" />
      </View>
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
  const pullSearch = useCatalogSearchPullGesture({
    gestureTestID: "pull-request-list-pull-to-search",
    initialOffset: 0,
    onOpenSearch: props.onOpenSearch,
    scope: "pull-requests",
  });
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
      ListEmptyComponent={<PullRequestEmptyState filter={props.filter} />}
      onEndReached={props.onEndReached}
      onEndReachedThreshold={0.4}
      onScroll={pullSearch.onScroll}
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
      renderScrollComponent={(scrollViewProps) => (
        <GestureDetector gesture={pullSearch.gesture}>
          <Animated.ScrollView {...scrollViewProps} />
        </GestureDetector>
      )}
      scrollEventThrottle={16}
    />
  );
}
