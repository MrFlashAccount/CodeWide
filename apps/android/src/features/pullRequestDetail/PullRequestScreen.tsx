import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../data/forgeConversationContract";
import { useMinuteClock } from "../../data/minuteClock";
import { useEvent } from "../../react/useEvent";
import { PrivateImageAccessProvider } from "../../rendering/use-private-image-uri";
import { colors } from "../../theme";
import { useAppDialog } from "../../ui/AppDialog";
import { ExtensionInputSheet } from "./actions/ExtensionInputSheet";
import { LinkedChatButton } from "./LinkedChatButton";
import { alertOfflineWrite } from "./actions/offlineRefusal";
import { openOnForge } from "./actions/openOnForge";
import { usePullRequestActions } from "./actions/usePullRequestActions";
import { PullRequestChanges } from "./changes/PullRequestChanges";
import { OverviewPane } from "./OverviewPane";
import { PullRequestAppBar } from "./PullRequestAppBar";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import { threadTitle, usePullRequestScreen } from "./usePullRequestScreen";

/**
 * PR screen: app bar, Details | Changes work surfaces and an intent that opens
 * the canonical linked conversation in route-owned geometry. Details suspends
 * behind the route-owned skeleton; files, drafts and the guide fill in
 * progressively below it. Offline, every forge write is refused locally.
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
    model,
    onDeferScenario: props.navigation.deferReviewChatScenario,
    onOpenThread: props.navigation.openThread,
    onRefresh: refresh,
    scenarioViews: data.scenarioViews,
    target: { ...params, headRevision: overview.headRevision, host },
  });
  const run = useEvent((action: ActionDescriptor, input: boolean | string | null): void => {
    if (data.offline) {
      alertOfflineWrite(dialog);
    } else {
      actions.run(action, input);
    }
  });
  const addressThread = useEvent((threadId: ReviewThreadId): void => {
    if (data.offline) {
      alertOfflineWrite(dialog);
    } else {
      actions.addressThread(threadId);
    }
  });
  const openReviewChat = useEvent((): void => {
    props.navigation.openReviewChat(data.agentThread?.threadId ?? null);
  });
  const extra = openOnForge(overview.webUrl, host);
  const appBar = (section: string | null, trailing: React.ReactNode): React.JSX.Element => (
    <PullRequestAppBar
      extra={extra}
      fullscreen={props.navigation.pullRequestFullscreen}
      icon={data.providerIcon}
      onBack={backFor(props)}
      onFullscreen={props.navigation.openPullRequestFullscreen}
      onRun={(action) => {
        run(action, null);
      }}
      overflow={data.slots.overflow}
      overview={overview}
      section={section}
      trailing={trailing}
    />
  );
  const getTransferAccess = useEvent(async (forceRefresh = false) =>
    props.capabilities.transferAccess(props.connectionId, forceRefresh),
  );
  return (
    // Description and comment images resolve through the same companion media access as the
    // conversation timeline; forge-hosted URLs are fetched by the plugin, never anonymously.
    <PrivateImageAccessProvider
      getAccess={getTransferAccess}
      scope={`pull-request:${props.connectionId}:${props.pullRequest}`}
    >
      <View style={styles.screen} testID="pull-request-screen">
        {props.tab === "overview" ? appBar(null, null) : null}
        {props.tab === "overview" ? (
          <OverviewPane
            data={data}
            nowMs={nowMs}
            onAddressThread={addressThread}
            onOpenChanges={props.navigation.openChanges}
            onRun={run}
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
            renderAppBar={appBar}
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
        {props.navigation.chatVisible ? null : (
          <LinkedChatButton
            disabled={false}
            isThreadUnread={props.isThreadUnread}
            label={
              data.agentThread === null
                ? "Start linked review chat"
                : `Open linked review chat: ${data.agentThread.title}`
            }
            onPress={openReviewChat}
            reviewThreadId={data.agentThread?.threadId ?? null}
          />
        )}
      </View>
    </PrivateImageAccessProvider>
  );
}

/** Changes always steps back to Details; Details steps back only where it is not a side pane. */
function backFor(props: PullRequestScreenProps): (() => void) | null {
  if (props.tab === "changes") {
    return props.navigation.closeChanges;
  }
  return props.tablet ? null : props.navigation.back;
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.conversationSurface,
    flex: 1,
  },
});
