import { useSelector } from "@legendapp/state/react";
import { useTransition } from "react";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../data/forgeConversationContract";
import { useMinuteClock } from "../../data/minuteClock";
import type { ThreadId } from "../../data/reviewContract";
import { useEvent } from "../../react/useEvent";
import { PrivateImageAccessProvider } from "../../rendering/use-private-image-uri";
import { useAppDialog } from "../../ui/AppDialog";
import type { ThreePanelsBack } from "../../ui/ThreePanelsHeader";
import { ExtensionInputSheet } from "./actions/ExtensionInputSheet";
import { FloatingActions } from "./FloatingActions";
import { alertOfflineWrite } from "./actions/offlineRefusal";
import { linkMenuItems } from "./actions/linkMenuItems";
import type { ExtraMenuItem } from "./actions/OverflowActionsMenu";
import { usePullRequestActions } from "./actions/usePullRequestActions";
import type { VerdictChoice } from "./overview/verdictChoice";
import { PullRequestChanges } from "./changes/PullRequestChanges";
import { OverviewPane } from "./OverviewPane";
import { PullRequestAppBar } from "./PullRequestAppBar";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import { refreshPullRequest } from "./refreshPullRequest";
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
  // The pull indicator is the pending async Transition: it ends when the shown refetches settle.
  const [pullRefreshing, startPullRefresh] = useTransition();
  const pullRefresh = useEvent((): void => {
    startPullRefresh(async () => {
      await refreshPullRequest(
        { forge: props.forge, review: props.review },
        { ...params, headRevision: overview.headRevision },
      );
    });
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
  // An agent run's chat; a settled run shows no thread of its own, so it opens the review chat.
  const openAgentChat = useEvent((threadId: ThreadId | null): void => {
    props.navigation.openReviewChat(threadId ?? data.agentThread?.threadId ?? null);
  });
  // The Details Submit sheet opens with one verdict; offline it is refused like every forge write.
  const openReview = useEvent((actionId: string): void => {
    if (data.offline) {
      alertOfflineWrite(dialog);
    } else {
      model.reviewVerdict.set(actionId);
    }
  });
  const closeReview = useEvent((): void => {
    model.reviewVerdict.set(null);
  });
  const staleReview = useEvent((kind: "outcomeUnknown" | "stale"): void => {
    model.notice.set({ kind });
    refresh();
  });
  const reportLinkError = useEvent((title: string, error: unknown): void => {
    dialog.error(title, error);
  });
  const extra = [
    ...linkMenuItems({
      forgeName: data.providerName,
      host,
      onError: reportLinkError,
      webUrl: overview.webUrl,
    }),
    ...submitReviewMenuItem(props.tab, data.verdictChoice, openReview),
  ];
  const appBar = (section: string | null, trailing: React.ReactNode): React.JSX.Element => (
    <PullRequestAppBar
      back={backFor(props)}
      extra={extra}
      icon={data.providerIcon}
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
      {/* The pane the screen is placed in paints its surface (ThreePanelsContext); none here. */}
      <View style={styles.screen} testID="pull-request-screen">
        {props.tab === "overview" ? appBar(null, null) : null}
        {props.tab === "overview" ? (
          <OverviewPane
            capabilities={props.capabilities}
            data={data}
            nowMs={nowMs}
            onAddressThread={addressThread}
            onCloseReview={closeReview}
            onOpenChanges={props.navigation.openChanges}
            onOpenReview={openReview}
            onOpenReviewChat={openAgentChat}
            onPullRefresh={pullRefresh}
            onRun={run}
            onStale={staleReview}
            pullRefreshing={pullRefreshing}
            state={state}
          />
        ) : (
          <PullRequestChanges
            agentThread={data.agentThread}
            capabilities={props.capabilities}
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
            onStale={staleReview}
            overview={overview}
            providerCapabilities={data.providerCapabilities}
            renderAppBar={appBar}
            review={props.review}
            reviewCapabilities={props.reviewCapabilities}
            tablet={props.tablet}
            verdicts={data.slots.verdicts}
            voiceRuntime={props.voiceRuntime}
          />
        )}
        {actions.pendingInput === null ? null : (
          <ExtensionInputSheet
            action={actions.pendingInput}
            onDismiss={actions.dismissInput}
            onSubmit={actions.submitInput}
          />
        )}
        <FloatingActions
          agentThread={data.agentThread}
          conversation={data.conversation}
          details={props.tab === "overview"}
          isThreadUnread={props.isThreadUnread}
          onComment={data.writes.comment}
          onOpenChat={openReviewChat}
        />
      </View>
    </PrivateImageAccessProvider>
  );
}

/**
 * Details offers Submit review in the app bar menu when only one verdict can be submitted (no
 * prominent verdict button); Changes has its own Submit control in the toolbar.
 */
function submitReviewMenuItem(
  tab: PullRequestScreenProps["tab"],
  choice: VerdictChoice,
  openReview: (actionId: string) => void,
): readonly ExtraMenuItem[] {
  if (tab !== "overview" || choice.kind !== "menu") {
    return [];
  }
  const { lead } = choice;
  return [
    {
      id: "submitReview",
      label: "Submit review",
      onSelect: () => {
        openReview(lead.actionId);
      },
    },
  ];
}

/**
 * Changes always steps back to Details inside its pane; Details leaves the screen only where the
 * route declares a Back, and a closable pane shows its `×` instead.
 */
function backFor(props: PullRequestScreenProps): ThreePanelsBack | null {
  if (props.tab === "changes") {
    return { kind: "nested", label: "Back", run: props.navigation.closeChanges };
  }
  const { back } = props.navigation;
  return back === null ? null : { kind: "exit", label: "Back", run: back };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
});
