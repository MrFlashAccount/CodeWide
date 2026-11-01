import { useSelector } from "@legendapp/state/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState, useTransition, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import type { AccountState, ForgeProvider } from "../../data/forgeContract";
import type { PullRequestListPage, PullRequestRow } from "../../data/forgePullRequestContract";
import { forgeQueryRemoteValue, useForgeQuery } from "../../data/forgeQueryResource";
import { remoteValue, type RemoteValue } from "../../data/forgeRemoteValue";
import type { ForgeResources } from "../../data/forgeResources";
import { CatalogSearchOverlayHost } from "../../presentation/layouts/CatalogSearchOverlayHost";
import { hasLinkedAccount } from "./accounts/accountPresentation";
import { useMinuteClock } from "../../data/minuteClock";
import { useEvent } from "../../react/useEvent";
import { AccountsSheet } from "./accounts/AccountsSheet";
import { PullRequestFilterSheet } from "./list/PullRequestFilterSheet";
import { PullRequestList, PullRequestSearchSurface } from "./list/PullRequestList";
import { AccountsPlaceholder } from "./onboarding/AccountsPlaceholder";
import { OnboardingScreen } from "./onboarding/OnboardingScreen";
import { PullRequestsHeader } from "./PullRequestsHeader";
import {
  forgeAccountsSheetOpen,
  openForgeAccounts,
  openPullRequestFilters,
  openPullRequestSearch,
  pullRequestListModel,
  pullRequestSearchModel,
  selectPullRequestSearchText,
  selectPullRequestSort,
} from "./pullRequestListModel";
import type { PullRequestsWorkspaceCapabilities } from "./workspaceCapabilities";

/**
 * `/pulls` content for one connection: the update card for an old companion,
 * onboarding while no account is linked, otherwise the PR list. Every read
 * comes from the model-owned forge resources; demands are idempotent.
 */
export function PullRequestsCatalog({
  capabilities,
  connectionId,
  forge,
  onOpenPullRequest,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly forge: ForgeResources;
  /** Navigation intent: reveals the PR destination immediately. */
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
}): React.JSX.Element {
  const accountsOpen = useSelector(forgeAccountsSheetOpen);
  const [openOnboardingConnection, setOpenOnboardingConnection] = useState<string | null>(null);
  const state = useForgeQuery(forge.accounts, { connectionId });
  const snapshot = remoteValue(state);
  const handleTrayOpenChange = useEvent((open: boolean): void => {
    setOpenOnboardingConnection(open ? connectionId : null);
    if (open) {
      revalidateProviders(forge, connectionId);
    }
  });
  const reconnect = useEvent((): void => {
    revalidateProviders(forge, connectionId);
    openForgeAccounts();
  });
  if (snapshot === null) {
    return (
      <CatalogFrame>
        <AccountsPlaceholder
          onRetry={() => {
            forge.accounts.refresh({ connectionId }).catch(() => undefined);
          }}
          state={state}
        />
      </CatalogFrame>
    );
  }
  const linked = hasLinkedAccount(snapshot);
  const onboardingOpen = openOnboardingConnection === connectionId;
  return (
    <View style={styles.fill}>
      {!linked || onboardingOpen ? (
        <CatalogFrame>
          <OnboardingScreen
            capabilities={capabilities}
            connectionId={connectionId}
            onTrayOpenChange={handleTrayOpenChange}
            snapshot={snapshot}
          />
        </CatalogFrame>
      ) : null}
      {linked && !onboardingOpen ? (
        <ConnectedList
          accounts={snapshot.accounts}
          connectionId={connectionId}
          forge={forge}
          onOpenPullRequest={onOpenPullRequest}
          onReconnect={reconnect}
          providers={snapshot.providers}
        />
      ) : null}
      {accountsOpen ? (
        <AccountsSheet
          capabilities={capabilities}
          connectionId={connectionId}
          onDismiss={() => {
            forgeAccountsSheetOpen.set(false);
          }}
          snapshot={snapshot}
        />
      ) : null}
    </View>
  );
}

function ConnectedList({
  accounts,
  connectionId,
  forge,
  onOpenPullRequest,
  onReconnect,
  providers,
}: {
  readonly accounts: readonly AccountState[];
  readonly connectionId: string;
  readonly forge: ForgeResources;
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly providers: readonly ForgeProvider[];
}): React.JSX.Element {
  const filter = useSelector(() => pullRequestListModel.get());
  const searchOpen = useSelector(() => pullRequestSearchModel.open.get());
  const searchDraft = useSelector(() => pullRequestSearchModel.draft.get());
  const deferredFilter = useDeferredValue(filter);
  const [, startFilterTransition] = useTransition();
  const nowMs = useMinuteClock();
  const params = {
    connectionId,
    filter: deferredFilter,
  };
  const query = useQuery(
    { ...forge.lists.options(params), placeholderData: keepPreviousData },
    forge.lists.client,
  );
  const state = forgeQueryRemoteValue(query);
  const pendingFilter = !query.isError && (filter !== deferredFilter || query.isPlaceholderData);
  const loadMore = useEvent((): void => {
    // A failed next page keeps the loaded pages; the next end-reached tries again.
    forge.loadMoreList(params).catch(() => undefined);
  });
  const retry = useEvent((): void => {
    forge.lists.refresh(params).catch(() => undefined);
  });
  const manageProviders = useEvent((): void => {
    revalidateProviders(forge, connectionId);
    openForgeAccounts();
  });
  const submitSearch = useEvent((text: string): void => {
    startFilterTransition(() => {
      selectPullRequestSearchText(text);
    });
  });
  const selectSort = useEvent((sort: Parameters<typeof selectPullRequestSort>[0]): void => {
    startFilterTransition(() => {
      selectPullRequestSort(sort);
    });
  });
  const listProps: Parameters<typeof PullRequestList>[0] = {
    filter,
    iconFor: (pluginId) =>
      providers.find((provider) => provider.pluginId === pluginId)?.icon ?? null,
    nowMs,
    onEndReached: loadMore,
    onOpen: onOpenPullRequest,
    onOpenFilters: openPullRequestFilters,
    onOpenSearch: openPullRequestSearch,
    onReconnect,
    onRetry: retry,
    onSearch: submitSearch,
    onSort: selectSort,
    pendingFilter,
    state,
  };
  const page = remoteValue(state);
  const refreshing = publishedListIsRefreshing(state, pendingFilter, page);
  return (
    <View style={styles.fill}>
      <CatalogSearchOverlayHost
        overlay={
          searchOpen ? <PullRequestSearchSurface draft={searchDraft} props={listProps} /> : null
        }
        testID="pull-request-search-host"
      >
        <PullRequestsHeader onManageProviders={manageProviders} refreshing={refreshing} />
        <PullRequestList {...listProps} />
      </CatalogSearchOverlayHost>
      <PullRequestFilterSheet
        accounts={accounts}
        providers={providers}
        repositories={page?.repositories ?? []}
      />
    </View>
  );
}

/**
 * Opening provider management revalidates the accounts snapshot in place, so
 * a plugin installed or removed on the host shows its current state without
 * hiding the published list while the read runs.
 */
function revalidateProviders(forge: ForgeResources, connectionId: string): void {
  forge.accounts.refresh({ connectionId }).catch(() => undefined);
}

function publishedListIsRefreshing(
  state: RemoteValue<PullRequestListPage>,
  pendingFilter: boolean,
  page: PullRequestListPage | null,
): boolean {
  return page !== null && (pendingFilter || (state.status === "ready" && state.refreshing));
}

function CatalogFrame({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return (
    <View style={styles.fill}>
      <PullRequestsHeader />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
