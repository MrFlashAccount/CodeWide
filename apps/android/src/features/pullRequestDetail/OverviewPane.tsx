import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../data/forgeConversationContract";
import type { ThreadId } from "../../data/reviewContract";
import { ScenarioViewsContext } from "./actions/ScenarioViewsContext";
import { useSubmitReview } from "./changes/useSubmitReview";
import { OverviewTab } from "./overview/OverviewTab";
import type { ChangesView, PullRequestScreenState } from "./pullRequestScreenModel";
import type { PullRequestScreenData } from "./usePullRequestScreen";
import type { PullRequestDetailWorkspaceCapabilities } from "./workspaceCapabilities";

/**
 * Details reading surface; the canonical linked conversation is composed by the route. Every
 * catalog action button below reads its live scenario run state from this pane. Owns the Details
 * Submit review attempt (its idempotency key and outcome); the sheet's verdict is screen state.
 */
export function OverviewPane({
  capabilities,
  data,
  nowMs,
  onAddressThread,
  onCloseReview,
  onOpenChanges,
  onOpenReview,
  onOpenReviewChat,
  onPullRefresh,
  onRun,
  onStale,
  pullRefreshing,
  state,
}: {
  readonly capabilities: PullRequestDetailWorkspaceCapabilities;
  readonly data: PullRequestScreenData;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onCloseReview: () => void;
  readonly onOpenChanges: (view: ChangesView) => void;
  /** Opens the Submit review sheet with one verdict; refused offline like every forge write. */
  readonly onOpenReview: (actionId: string) => void;
  /** Opens an agent run's chat, or the PR's review chat when the run's thread is not known. */
  readonly onOpenReviewChat: (threadId: ThreadId | null) => void;
  /** Pull-to-refresh: re-reads everything Details shows. */
  readonly onPullRefresh: () => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  /** The head moved, or a Submit's outcome is unknown: show it and refresh. */
  readonly onStale: (kind: "outcomeUnknown" | "stale") => void;
  /** A pull refresh is running; the indicator stays until its reads settle. */
  readonly pullRefreshing: boolean;
  readonly state: PullRequestScreenState;
}): React.JSX.Element {
  const { overview } = data;
  const { result, submit } = useSubmitReview({
    capabilities,
    drafts: data.drafts,
    onStale,
    target: {
      connectionId: data.params.connectionId,
      headRevision: overview.headRevision,
      pullRequest: overview.pullRequest,
    },
  });
  return (
    <ScenarioViewsContext.Provider value={data.scenarioViews}>
      <OverviewTab
        activity={data.activity.items}
        addressing={state.addressingThreads}
        conversation={data.conversation}
        draftCount={data.draftCount}
        host={overview.account.host}
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
        overview={overview}
        pending={state.pending}
        pendingToggles={state.pendingToggles}
        pullRefreshing={pullRefreshing}
        review={{
          bothTargetTitle: data.agentThread?.title ?? null,
          choice: data.verdictChoice,
          drafts: data.drafts,
          host: overview.account.host,
          onClose: onCloseReview,
          onOpen: onOpenReview,
          openVerdictId: state.reviewVerdict,
          result,
          submit,
          verdicts: data.slots.verdicts,
        }}
        slots={data.slots}
        writes={data.writes}
      />
    </ScenarioViewsContext.Provider>
  );
}
