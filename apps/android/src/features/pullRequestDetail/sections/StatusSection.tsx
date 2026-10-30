import { View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import type { PullRequestOverview } from "../../../data/forgePullRequestContract";
import type { ActionSlots } from "../actions/actionSlotting";
import type { Discussion, StatusSummary } from "../conversation/discussionModel";
import { IssuesStatusRow } from "../conversation/IssuesStatusRow";
import { ReviewsStatusRow } from "../conversation/ReviewsStatusRow";
import { ChecksStatusRow } from "../overview/ChecksStatusRow";
import { MergeBox } from "../overview/MergeBox";
import type { MergeBoxRow } from "../overview/mergeBox";
import { SectionBand } from "./SectionBand";
import { firstStatusRow, statusRows } from "./statusRows";

/** Everything the Status section summarizes; the screen owns data and intents. */
export type StatusSectionProps = {
  readonly addressing: Readonly<Record<string, true>>;
  /** The projected conversation, `null` while it loads or without `forge.conversation@1`. */
  readonly discussion: Discussion | null;
  readonly host: string;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onReveal: (threadId: ReviewThreadId) => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: ActionSlots;
};

/**
 * The Status band, GitHub Mobile style: one expandable row per fact that
 * decides merging. Issues (open forge issues, Address in agent and View
 * code), Reviews (standing verdicts on the loaded conversation), Checks (the
 * failing ones inline, every check in its sheet), then the merge state with
 * its conflict actions, merge method and auto-merge. A row exists only when
 * its data does; without any row there is no band. Every row after the
 * first draws an inset divider.
 */
export function StatusSection(props: StatusSectionProps): React.JSX.Element | null {
  const rows = statusRows(props.overview, props.discussion);
  const first = firstStatusRow(rows);
  if (first === null) {
    return null;
  }
  return (
    <View testID="pull-request-status">
      <SectionBand testID="pull-request-status-band" title="Status" />
      <IssuesSlot {...props} summary={rows.issues} />
      <ReviewsSlot {...props} divided={first !== "reviews"} summary={rows.reviews} />
      <ChecksSlot {...props} checks={rows.checks} divided={first !== "checks"} />
      <MergeBox
        divided={first !== "merge"}
        host={props.host}
        onRun={props.onRun}
        overview={props.overview}
        pending={props.pending}
        pendingToggles={props.pendingToggles}
        slots={props.slots}
      />
    </View>
  );
}

/** Issues always come first, so the row never draws a divider. */
function IssuesSlot(
  props: StatusSectionProps & { readonly summary: StatusSummary | null },
): React.JSX.Element | null {
  const { discussion, summary } = props;
  if (summary === null || discussion === null) {
    return null;
  }
  return (
    <IssuesStatusRow
      addressing={props.addressing}
      divided={false}
      nowMs={props.nowMs}
      onAddressThread={props.onAddressThread}
      onReveal={props.onReveal}
      open={discussion.openIssues}
      settled={discussion.settledIssues}
      summary={summary}
    />
  );
}

function ReviewsSlot(
  props: StatusSectionProps & {
    readonly divided: boolean;
    readonly summary: StatusSummary | null;
  },
): React.JSX.Element | null {
  const { discussion, summary } = props;
  if (summary === null || discussion === null) {
    return null;
  }
  return (
    <ReviewsStatusRow
      divided={props.divided}
      nowMs={props.nowMs}
      reviewers={discussion.reviewers}
      summary={summary}
    />
  );
}

function ChecksSlot(
  props: StatusSectionProps & {
    readonly checks: MergeBoxRow | null;
    readonly divided: boolean;
  },
): React.JSX.Element | null {
  if (props.checks === null) {
    return null;
  }
  return (
    <ChecksStatusRow
      checks={props.checks}
      divided={props.divided}
      host={props.host}
      items={props.overview.checkItems}
      onRun={(action) => {
        props.onRun(action, null);
      }}
      pending={props.pending}
      slots={props.slots}
    />
  );
}
