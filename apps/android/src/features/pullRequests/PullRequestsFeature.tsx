import { useSelector } from "@legendapp/state/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useState, useTransition } from "react";
import { StyleSheet, View } from "react-native";

import type { AccountState, ForgeProvider } from "../../data/forgeContract";
import type { PullRequestCategory, PullRequestRow } from "../../data/forgePullRequestContract";
import { forgeQueryRemoteValue, useForgeQuery } from "../../data/forgeQueryResource";
import { remoteValue } from "../../data/forgeRemoteValue";
import type { ForgeResources } from "../../data/forgeResources";
import { hasLinkedAccount } from "./accounts/accountPresentation";
import { useMinuteClock } from "../../data/minuteClock";
import { useEvent } from "../../react/useEvent";
import { AccountsSheet } from "./accounts/AccountsSheet";
import { PullRequestList } from "./list/PullRequestList";
import { AccountsPlaceholder } from "./onboarding/AccountsPlaceholder";
import { OnboardingScreen } from "./onboarding/OnboardingScreen";
import {
  forgeAccountsSheetOpen,
  openForgeAccounts,
  pullRequestListModel,
  selectPullRequestCategory,
  selectPullRequestRepository,
  type PullRequestListFilter,
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
  });
  if (snapshot === null) {
    return (
      <AccountsPlaceholder
        onRetry={() => {
          forge.accounts.refresh({ connectionId }).catch(() => undefined);
        }}
        state={state}
      />
    );
  }
  const linked = hasLinkedAccount(snapshot);
  const onboardingOpen = openOnboardingConnection === connectionId;
  return (
    <View style={styles.fill}>
      {!linked || onboardingOpen ? (
        <OnboardingScreen
          capabilities={capabilities}
          connectionId={connectionId}
          onTrayOpenChange={handleTrayOpenChange}
          snapshot={snapshot}
        />
      ) : null}
      {linked && !onboardingOpen ? (
        <ConnectedList
          connectionId={connectionId}
          forge={forge}
          onOpenPullRequest={onOpenPullRequest}
          onReconnect={openForgeAccounts}
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
  connectionId,
  forge,
  onOpenPullRequest,
  onReconnect,
  providers,
}: {
  readonly connectionId: string;
  readonly forge: ForgeResources;
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly providers: readonly ForgeProvider[];
}): React.JSX.Element {
  const filter = useSelector(() => pullRequestListModel.get());
  const deferredFilter = useDeferredValue(filter);
  const [, startFilterTransition] = useTransition();
  const nowMs = useMinuteClock();
  const params = {
    category: deferredFilter.category,
    connectionId,
    repository: deferredFilter.repository,
  };
  const query = useQuery(
    { ...forge.lists.options(params), placeholderData: keepPreviousData },
    forge.lists.client,
  );
  const state = forgeQueryRemoteValue(query);
  const page = remoteValue(state);
  const pendingFilter = filterPendingState({
    current: filter,
    deferred: deferredFilter,
    failed: query.isError,
    placeholder: query.isPlaceholderData,
    placeholderCategory: page?.category ?? null,
  });
  const loadMore = useEvent((): void => {
    // A failed next page keeps the loaded pages; the next end-reached tries again.
    forge.loadMoreList(params).catch(() => undefined);
  });
  const retry = useEvent((): void => {
    forge.lists.refresh(params).catch(() => undefined);
  });
  const selectCategory = useEvent((category: PullRequestListFilter["category"]): void => {
    startFilterTransition(() => {
      selectPullRequestCategory(category);
    });
  });
  const selectRepository = useEvent((repository: string | null): void => {
    startFilterTransition(() => {
      selectPullRequestRepository(repository);
    });
  });
  return (
    <PullRequestList
      filter={filter}
      iconFor={(pluginId) =>
        providers.find((provider) => provider.pluginId === pluginId)?.icon ?? null
      }
      nowMs={nowMs}
      onCategory={selectCategory}
      onEndReached={loadMore}
      onOpen={onOpenPullRequest}
      onReconnect={onReconnect}
      onRepository={selectRepository}
      onRetry={retry}
      pendingFilter={pendingFilter}
      state={state}
    />
  );
}

function filterPendingState({
  current,
  deferred,
  failed,
  placeholder,
  placeholderCategory,
}: {
  readonly current: PullRequestListFilter;
  readonly deferred: PullRequestListFilter;
  readonly failed: boolean;
  readonly placeholder: boolean;
  readonly placeholderCategory: PullRequestCategory | null;
}): { readonly category: boolean; readonly repository: boolean } {
  if (failed) {
    return { category: false, repository: false };
  }
  return {
    category:
      current.category !== deferred.category ||
      (placeholder && placeholderCategory !== current.category),
    repository:
      current.repository !== deferred.repository ||
      (placeholder && placeholderCategory === current.category),
  };
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
