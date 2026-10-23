import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import { remoteValue } from "../../data/forgeRemoteValue";
import { useForgeQuery } from "../../data/forgeQueryResource";
import { useMinuteClock } from "../../data/minuteClock";
import type { ThreadId } from "../../data/reviewContract";
import { useEvent } from "../../react/useEvent";
import { colors } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { ExtensionInputSheet } from "./actions/ExtensionInputSheet";
import { openOnForge } from "./actions/openOnForge";
import { usePullRequestActions } from "./actions/usePullRequestActions";
import { PullRequestChanges } from "./changes/PullRequestChanges";
import { OverviewPane } from "./OverviewPane";
import { PullRequestAppBar } from "./PullRequestAppBar";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import { PullRequestTabs } from "./PullRequestTabs";
import { threadTitle, usePullRequestScreen } from "./usePullRequestScreen";

/**
 * PR screen (direction B): app bar, Overview | Changes tabs and one dock per
 * tab. It suspends on the overview Promise that navigation preloaded, so the
 * previous screen stays until the summary exists; files, drafts and the guide
 * fill in progressively below it. Offline, every write is refused locally.
 */
export function PullRequestScreen(props: PullRequestScreenProps): React.JSX.Element {
  const data = usePullRequestScreen(props);
  const { model, overview, params } = data;
  const dialog = useAppDialog();
  const nowMs = useMinuteClock();
  const state = useSelector(() => model.get());
  const host = overview.account.host;
  const refresh = useEvent((): void => {
    props.forge.overviews.refresh(params).catch(() => undefined);
  });
  const actions = usePullRequestActions({
    capabilities: props.capabilities,
    describeThread: props.describeThread,
    links: overview.links,
    model,
    onOpenThread: props.navigation.openThread,
    onRefresh: refresh,
    target: { ...params, headRevision: overview.headRevision, host },
  });
  const run = useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    if (data.offline) {
      dialog.alert("The companion is offline", "Writes need an acknowledged companion request.");
    } else {
      actions.run(action, input);
    }
  });
  const unlink = useEvent((threadId: ThreadId): void => {
    props.capabilities.setLink(params, threadId, false).catch((error: unknown) => {
      dialog.error("Could not unlink the thread", error);
    });
  });
  const extra = openOnForge(overview.webUrl, host);
  const icon = useProviderIcon(props, overview.account.pluginId);
  return (
    <View style={styles.screen} testID="pull-request-screen">
      <PullRequestAppBar
        extra={extra}
        icon={icon}
        onBack={props.navigation.back}
        onRun={(action) => {
          run(action, null);
        }}
        overflow={state.tab === "overview" ? [] : data.slots.overflow}
        overview={overview}
      />
      <PullRequestTabs
        draftCount={data.draftCount}
        onSelect={(next) => {
          model.tab.set(next);
        }}
        tab={state.tab}
      />
      {state.tab === "overview" ? (
        <OverviewPane
          actions={actions}
          data={data}
          extra={extra}
          nowMs={nowMs}
          onRun={run}
          onUnlink={unlink}
          props={props}
          state={state}
        />
      ) : (
        <PullRequestChanges
          agentThread={data.agentThread}
          capabilities={props.capabilities}
          commentDestinations={props.commentDestinations}
          connectionId={props.connectionId}
          describeThread={(threadId) => threadTitle(props.describeThread, threadId)}
          fileActions={data.slots.anchored.files}
          forge={props.forge}
          host={host}
          model={model}
          nowMs={nowMs}
          offline={data.offline}
          onRun={(action) => {
            run(action, null);
          }}
          onStale={(kind) => {
            model.notice.set({ kind });
            refresh();
          }}
          overview={overview}
          ownPullRequest={overview.author === overview.account.login}
          review={props.review}
          reviewCapabilities={props.reviewCapabilities}
          tablet={props.tablet}
          verdicts={data.slots.verdicts}
        />
      )}
      {actions.pendingInput === null ? null : (
        <ExtensionInputSheet
          action={actions.pendingInput}
          onDismiss={actions.dismissInput}
          onSubmit={actions.submitInput}
        />
      )}
    </View>
  );
}

/** Provider icon of the PR's account from the accounts resource, if loaded. */
function useProviderIcon(props: PullRequestScreenProps, pluginId: string) {
  // A cold deep link has no catalog behind it; the mark still comes from the accounts snapshot.
  const accounts = useForgeQuery(props.forge.accounts, { connectionId: props.connectionId });
  return (
    remoteValue(accounts)?.providers.find((candidate) => candidate.pluginId === pluginId)?.icon ??
    null
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
  },
});
