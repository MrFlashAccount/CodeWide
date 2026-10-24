import { LegendList } from "@legendapp/list/react-native";
import { useSelector } from "@legendapp/state/react";
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
import { SearchOverlayMotion } from "../../../presentation/input/SearchOverlayMotionView";
import { useSearchOverlayMotion } from "../../../presentation/input/searchOverlayMotion";
import { layoutSize } from "../../../theme";
import type { PullRequestSearchFilter } from "../../../data/forgePullRequestSearch";
import { listStyles as styles } from "./list.styles";
import { ListSkeleton } from "./ListSkeleton";
import { ListNotice } from "./ListNotice";
import { PullRequestEmptyState } from "./PullRequestEmptyState";
import { pullRequestListItems } from "./pullRequestListItems";
import { PullRequestListItemView } from "./PullRequestListItemView";
import { PullRequestFilterBar, PullRequestSearchHeader } from "./PullRequestFilterBar";
import { PullRequestFilterSheet } from "./PullRequestFilterSheet";
import {
  activePullRequestFilterCount,
  closePullRequestSearch,
  pullRequestSearchModel,
} from "../pullRequestListModel";

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
  const search = useSelector(() => pullRequestSearchModel.get());
  const page = remoteValue(props.state);
  const items = listItems(page);
  return (
    <View style={styles.fill} testID="pull-request-list">
      <PullRequestCatalogSurface hidden={search.open} items={items} page={page} props={props} />
      {search.open ? (
        <PullRequestSearchSurface draft={search.draft} items={items} page={page} props={props} />
      ) : null}
      <PullRequestFilterSheet
        accounts={props.accounts}
        providers={props.providers}
        repositories={page?.repositories ?? []}
      />
    </View>
  );
}

function PullRequestCatalogSurface({
  hidden,
  items,
  page,
  props,
}: {
  readonly hidden: boolean;
  readonly items: ReturnType<typeof pullRequestListItems>;
  readonly page: PullRequestListPage | null;
  readonly props: Parameters<typeof PullRequestList>[0];
}): React.JSX.Element {
  return (
    <View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      pointerEvents={hidden ? "none" : "auto"}
      style={styles.fill}
    >
      <PullRequestFilterBar
        filter={props.filter}
        onOpenFilters={props.onOpenFilters}
        onOpenSearch={props.onOpenSearch}
        onSort={props.onSort}
      />
      <ListNotice
        nowMs={props.nowMs}
        state={visibleNoticeState(props.state, props.pendingFilter)}
      />
      <PullRequestCatalogRows items={items} page={page} props={props} />
    </View>
  );
}

function PullRequestCatalogRows({
  items,
  page,
  props,
}: {
  readonly items: ReturnType<typeof pullRequestListItems>;
  readonly page: PullRequestListPage | null;
  readonly props: Parameters<typeof PullRequestList>[0];
}): React.JSX.Element {
  return (
    <View style={styles.fill}>
      <PullRequestRows items={items} page={page} props={props} pullToSearch />
      <CatalogSearchPullBackdrop testID="pull-request-list-pull-backdrop" />
    </View>
  );
}

function PullRequestSearchSurface({
  draft,
  items,
  page,
  props,
}: {
  readonly draft: string;
  readonly items: ReturnType<typeof pullRequestListItems>;
  readonly page: PullRequestListPage | null;
  readonly props: Parameters<typeof PullRequestList>[0];
}): React.JSX.Element {
  const overlay = useSearchOverlayMotion(closePullRequestSearch);
  return (
    <View style={styles.searchOverlay}>
      <SearchOverlayMotion onBackdropPress={overlay.close} progress={overlay.progress}>
        <PullRequestSearchPanel
          close={overlay.close}
          draft={draft}
          items={items}
          page={page}
          props={props}
        />
      </SearchOverlayMotion>
    </View>
  );
}

function PullRequestSearchPanel({
  close,
  draft,
  items,
  page,
  props,
}: {
  readonly close: () => void;
  readonly draft: string;
  readonly items: ReturnType<typeof pullRequestListItems>;
  readonly page: PullRequestListPage | null;
  readonly props: Parameters<typeof PullRequestList>[0];
}): React.JSX.Element {
  return (
    <View style={styles.fill} testID="pull-request-search-overlay">
      <PullRequestSearchHeader
        activeCount={activePullRequestFilterCount(props.filter)}
        close={close}
        draft={draft}
        onOpenFilters={props.onOpenFilters}
        onSearch={props.onSearch}
      />
      <ListNotice
        nowMs={props.nowMs}
        state={visibleNoticeState(props.state, props.pendingFilter)}
      />
      <PullRequestRows items={items} page={page} props={props} pullToSearch={false} />
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
  pullToSearch,
}: {
  readonly items: ReturnType<typeof pullRequestListItems>;
  readonly page: PullRequestListPage | null;
  readonly props: Parameters<typeof PullRequestList>[0];
  readonly pullToSearch: boolean;
}): React.JSX.Element {
  const pullSearch = useCatalogSearchPullGesture({
    enabled: pullToSearch,
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
