import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ThreadId } from "../../data/reviewContract";
import type { ExtraMenuItem } from "./actions/OverflowActionsMenu";
import type { PullRequestActions } from "./actions/usePullRequestActions";
import { messageDockTarget } from "./dock/messageDockTarget";
import { PullRequestMessageDock } from "./dock/PullRequestMessageDock";
import { OverviewTab } from "./overview/OverviewTab";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import type { PullRequestScreenState } from "./pullRequestScreenModel";
import type { PullRequestScreenData } from "./usePullRequestScreen";

/** Overview tab and its dock: a message to the linked agent about this PR. */
export function OverviewPane({
  actions,
  data,
  extra,
  nowMs,
  onRun,
  onUnlink,
  props,
  state,
}: {
  readonly actions: PullRequestActions;
  readonly data: PullRequestScreenData;
  readonly extra: readonly ExtraMenuItem[];
  readonly nowMs: number;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly onUnlink: (threadId: ThreadId) => void;
  readonly props: PullRequestScreenProps;
  readonly state: PullRequestScreenState;
}): React.JSX.Element {
  const dock = messageDockTarget(
    data.overview.links,
    state.messageTarget,
    (threadId) => props.describeThread(threadId)?.title ?? "Linked thread",
  );
  return (
    <>
      <OverviewTab
        activity={data.activity.items}
        describeThread={props.describeThread}
        extraOverflow={extra}
        host={data.overview.account.host}
        listRow={data.listRow}
        notice={state.notice}
        nowMs={nowMs}
        onActionRowWidth={data.setRowWidth}
        onLoadMoreActivity={data.loadMoreActivity}
        onOpenThread={props.navigation.openThread}
        onRun={onRun}
        onUnlink={onUnlink}
        overview={data.overview}
        pending={state.pending}
        pendingToggles={state.pendingToggles}
        slots={data.slots}
        tablet={props.tablet}
      />
      <PullRequestMessageDock
        disabled={data.offline}
        onChoose={(choice) => {
          data.model.messageTarget.set(choice);
        }}
        onSend={(text, lifecycle) => {
          actions.startScenario({
            checkId: null,
            pendingId: null,
            scenario: "message",
            target: dock.target,
            text,
            ...lifecycle,
          });
        }}
        target={dock}
      />
    </>
  );
}
