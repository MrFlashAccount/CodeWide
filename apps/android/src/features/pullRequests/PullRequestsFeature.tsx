import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View } from "react-native";

import type { AccountState, ForgeProvider } from "../../data/forgeContract";
import type { PullRequestRow } from "../../data/forgePullRequestContract";
import { remoteValue } from "../../data/forgeRemoteValue";
import type { ForgeResources } from "../../data/forgeResources";
import { hasLinkedAccount } from "./accounts/accountPresentation";
import { useMinuteClock } from "../../data/minuteClock";
import { useEvent } from "../../react/useEvent";
import { AccountsSheet } from "./accounts/AccountsSheet";
import { ListSkeleton } from "./list/ListSkeleton";
import { PullRequestList } from "./list/PullRequestList";
import { AccountsPlaceholder } from "./onboarding/AccountsPlaceholder";
import { OnboardingScreen } from "./onboarding/OnboardingScreen";
import {
  forgeAccountsSheetOpen,
  openForgeAccounts,
  pullRequestListModel,
  selectPullRequestCategory,
  selectPullRequestRepository,
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
  openingKey,
}: {
  readonly capabilities: PullRequestsWorkspaceCapabilities;
  readonly connectionId: string;
  readonly forge: ForgeResources;
  /** Navigation intent: preloads the overview, then reveals the PR screen. */
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
  readonly openingKey: string | null;
}): React.JSX.Element {
  forge.accounts.ensure({ connectionId });
  const accountsOpen = useSelector(forgeAccountsSheetOpen);
  const state = useSelector(() => forge.accounts.state$[connectionId]?.get());
  const snapshot = remoteValue(state);
  if (snapshot === null) {
    return (
      <AccountsPlaceholder
        onRetry={() => {
          forge.accounts.revalidate({ connectionId });
        }}
        state={state}
      />
    );
  }
  return (
    <View style={styles.fill}>
      {hasLinkedAccount(snapshot) ? null : (
        <OnboardingScreen
          capabilities={capabilities}
          connectionId={connectionId}
          snapshot={snapshot}
        />
      )}
      {hasLinkedAccount(snapshot) ? (
        <ConnectedList
          connectionId={connectionId}
          forge={forge}
          onOpenPullRequest={onOpenPullRequest}
          onReconnect={openForgeAccounts}
          openingKey={openingKey}
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
  openingKey,
  providers,
}: {
  readonly connectionId: string;
  readonly forge: ForgeResources;
  readonly onOpenPullRequest: (row: PullRequestRow) => void;
  readonly onReconnect: (account: AccountState) => void;
  readonly openingKey: string | null;
  readonly providers: readonly ForgeProvider[];
}): React.JSX.Element {
  const filter = useSelector(() => pullRequestListModel.get());
  const nowMs = useMinuteClock();
  const params = { category: filter.category, connectionId, repository: filter.repository };
  forge.lists.ensure(params);
  const state = useSelector(() => forge.lists.state$[forge.lists.keyOf(params)]?.get());
  const loadMore = useEvent((): void => {
    // A failed next page keeps the loaded pages; the next end-reached tries again.
    forge.loadMoreList(params).catch(() => undefined);
  });
  const retry = useEvent((): void => {
    forge.lists.revalidate(params);
  });
  if (
    state === undefined ||
    state.status === "idle" ||
    (state.status === "loading" && state.value === null)
  ) {
    return <ListSkeleton />;
  }
  return (
    <PullRequestList
      filter={filter}
      iconFor={(pluginId) =>
        providers.find((provider) => provider.pluginId === pluginId)?.icon ?? null
      }
      nowMs={nowMs}
      onCategory={selectPullRequestCategory}
      onEndReached={loadMore}
      onOpen={onOpenPullRequest}
      onReconnect={onReconnect}
      onRepository={selectPullRequestRepository}
      onRetry={retry}
      openingKey={openingKey}
      state={state}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
