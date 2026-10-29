import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../data/forgeConversationContract";
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
  onRun,
  state,
}: {
  readonly data: PullRequestScreenData;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onOpenChanges: (view: ChangesView) => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
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
        onRun={onRun}
        overview={data.overview}
        pending={state.pending}
        pendingToggles={state.pendingToggles}
        slots={data.slots}
        writes={data.writes}
      />
    </ScenarioViewsContext.Provider>
  );
}
