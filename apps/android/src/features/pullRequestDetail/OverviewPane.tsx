import type { ActionDescriptor } from "../../data/forgeActionCatalog";
import type { ExtraMenuItem } from "./actions/OverflowActionsMenu";
import { OverviewTab } from "./overview/OverviewTab";
import type { PullRequestScreenProps } from "./pullRequestScreenContract";
import type { PullRequestScreenState } from "./pullRequestScreenModel";
import type { PullRequestScreenData } from "./usePullRequestScreen";

/** Details reading surface; the canonical linked conversation is composed by the route. */
export function OverviewPane({
  data,
  extra,
  nowMs,
  onOpenReviewChat,
  onRun,
  props,
  state,
}: {
  readonly data: PullRequestScreenData;
  readonly extra: readonly ExtraMenuItem[];
  readonly nowMs: number;
  readonly onOpenReviewChat: () => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly props: PullRequestScreenProps;
  readonly state: PullRequestScreenState;
}): React.JSX.Element {
  return (
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
      onOpenReviewChat={onOpenReviewChat}
      onRun={onRun}
      overview={data.overview}
      pending={state.pending}
      pendingToggles={state.pendingToggles}
      slots={data.slots}
      tablet={props.tablet}
    />
  );
}
