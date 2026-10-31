import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../data/forgeConversationContract";
import type { ThreadId } from "../../data/reviewContract";
import { ScenarioViewsContext } from "./actions/ScenarioViewsContext";
import { OverviewTab } from "./overview/OverviewTab";
import type { ChangesView, PullRequestScreenState } from "./pullRequestScreenModel";
import type { PullRequestScreenData } from "./usePullRequestScreen";

/**
 * Details reading surface; the canonical linked conversation is composed by the route. Every
 * catalog action button below reads its live scenario run state from this pane.
 */
export function OverviewPane({
  data,
  nowMs,
  onAddressThread,
  onOpenChanges,
  onOpenReviewChat,
  onPullRefresh,
  onRun,
  pullRefreshing,
  state,
}: {
  readonly data: PullRequestScreenData;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onOpenChanges: (view: ChangesView) => void;
  /** Opens an agent run's chat, or the PR's review chat when the run's thread is not known. */
  readonly onOpenReviewChat: (threadId: ThreadId | null) => void;
  /** Pull-to-refresh: re-reads everything Details shows. */
  readonly onPullRefresh: () => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  /** A pull refresh is running; the indicator stays until its reads settle. */
  readonly pullRefreshing: boolean;
  readonly state: PullRequestScreenState;
}): React.JSX.Element {
  return (
    <ScenarioViewsContext.Provider value={data.scenarioViews}>
      <OverviewTab
        activity={data.activity.items}
        addressing={state.addressingThreads}
        conversation={data.conversation}
        draftCount={data.draftCount}
        host={data.overview.account.host}
        listRow={data.listRow}
        notice={
          state.notice ??
          (data.scenarioFailure === null ? null : { kind: "agentFailed", ...data.scenarioFailure })
        }
        nowMs={nowMs}
        onActionRowWidth={data.setRowWidth}
        onAddressThread={onAddressThread}
        onLoadMoreActivity={data.loadMoreActivity}
        onOpenChanges={onOpenChanges}
        onOpenReviewChat={onOpenReviewChat}
        onPullRefresh={onPullRefresh}
        onRun={onRun}
        overview={data.overview}
        pending={state.pending}
        pendingToggles={state.pendingToggles}
        pullRefreshing={pullRefreshing}
        slots={data.slots}
        writes={data.writes}
      />
    </ScenarioViewsContext.Provider>
  );
}
