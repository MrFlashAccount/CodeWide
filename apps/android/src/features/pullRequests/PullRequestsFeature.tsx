import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import type { AccountState, ForgeProvider } from "../../data/forgeContract";
import type { PullRequestRow } from "../../data/forgePullRequestContract";
import { useForgeQuery } from "../../data/forgeQueryResource";
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
  const state = useForgeQuery(forge.lists, params);
  const loadMore = useEvent((): void => {
    // A failed next page keeps the loaded pages; the next end-reached tries again.
    forge.loadMoreList(params).catch(() => undefined);
  });
  const retry = useEvent((): void => {
    forge.lists.refresh(params).catch(() => undefined);
  });
  if (state.status === "loading" && state.value === null) {
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
