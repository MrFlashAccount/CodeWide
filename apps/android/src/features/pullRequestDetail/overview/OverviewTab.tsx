import { ScrollView, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type {
  ActivityItem,
  PullRequestOverview,
  PullRequestRow,
} from "../../../data/forgePullRequestContract";
import type { ThreadId } from "../../../data/reviewContract";
import { spacing } from "../../../theme";
import type { ExtraMenuItem } from "../actions/OverflowActionsMenu";
import type { ActionSlots } from "../actions/actionSlotting";
import type { ActionNotice } from "../pullRequestScreenModel";
import { ActionNoticeBanner } from "./ActionNoticeBanner";
import { ActionRow } from "./ActionRow";
import { ActivitySection } from "./ActivitySection";
import { ChecksCard } from "./ChecksCard";
import { ConflictBanner } from "./ConflictBanner";
import { DescriptionSection } from "./DescriptionSection";
import { LinkedThreadsCard, type LinkedThreadDescription } from "./LinkedThreadsCard";
import { MergeCard } from "./MergeCard";
import { StatusHeader } from "./StatusHeader";

/** Everything the Overview tab renders; the screen owns data and intents. */
export type OverviewTabProps = {
  readonly activity: readonly ActivityItem[];
  readonly describeThread: (threadId: ThreadId) => LinkedThreadDescription | null;
  readonly extraOverflow: readonly ExtraMenuItem[];
  readonly host: string;
  /** The PR's row from a loaded list; `null` on a cold deep link. */
  readonly listRow: PullRequestRow | null;
  readonly notice: ActionNotice | null;
  readonly nowMs: number;
  readonly onActionRowWidth: (width: number) => void;
  readonly onLoadMoreActivity: (() => void) | null;
  readonly onOpenThread: (threadId: ThreadId) => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly onUnlink: (threadId: ThreadId) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: ActionSlots;
  readonly tablet: boolean;
};

const RAIL_WIDTH = 320;

/** The refusal shown on the merge card when it came from a merge-card action. */
function mergeCardRefusal(
  props: OverviewTabProps,
): { readonly actionId: string; readonly reason: string } | null {
  const { notice, slots } = props;
  if (notice?.kind !== "refused") {
    return null;
  }
  const onCard =
    slots.autoMerge?.actionId === notice.actionId ||
    slots.merge.some((action) => action.actionId === notice.actionId);
  return onCard ? notice : null;
}

/**
 * Overview: status and blockers before the diff (R3). Phone is one column with
 * rail cards after the action row; ≥720dp is a work column plus a 320dp rail
 * (merge, checks, linked threads). The description follows activity on phone.
 */
export function OverviewTab(props: OverviewTabProps): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.content} testID="pull-request-overview">
      {props.tablet ? <TabletColumns {...props} /> : <PhoneColumn {...props} />}
    </ScrollView>
  );
}

function PhoneColumn(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={styles.column}>
      <WorkHeader {...props} />
      <RailCards {...props} />
      <Activity {...props} />
      <DescriptionSection description={props.overview.description} />
    </View>
  );
}

function TabletColumns(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={styles.columns}>
      <View style={[styles.column, styles.workColumn]}>
        <WorkHeader {...props} />
        <DescriptionSection description={props.overview.description} />
        <Activity {...props} />
      </View>
      <View style={styles.rail}>
        <RailCards {...props} />
      </View>
    </View>
  );
}

/** Status, the action row and the notices and conflict banner that belong to it. */
function WorkHeader(props: OverviewTabProps): React.JSX.Element {
  const { overview, slots } = props;
  const run = (action: ActionDescriptor): void => {
    props.onRun(action, null);
  };
  const refusal =
    props.notice?.kind === "refused" && mergeCardRefusal(props) === null ? props.notice : null;
  return (
    <View style={styles.column}>
      <StatusHeader listRow={props.listRow} nowMs={props.nowMs} overview={overview} />
      <ActionRow
        extra={props.extraOverflow}
        onLayoutWidth={props.onActionRowWidth}
        onRun={run}
        pending={props.pending}
        slots={slots}
      />
      <ActionNoticeBanner
        host={props.host}
        notice={
          refusal === null
            ? props.notice
            : { kind: "message", text: `✕ ${props.host} refused: ${refusal.reason}` }
        }
      />
      {overview.merge.state === "conflicts" ? (
        <ConflictBanner
          actions={slots.anchored.conflict}
          baseBranch={overview.baseBranch}
          onRun={run}
          pending={props.pending}
          reason={overview.merge.reason}
        />
      ) : null}
    </View>
  );
}

/** Merge, checks and linked threads: the rail on tablets, after the action row on phones. */
function RailCards(props: OverviewTabProps): React.JSX.Element {
  const { slots } = props;
  return (
    <View style={styles.column}>
      <MergeCard
        autoMerge={slots.autoMerge}
        host={props.host}
        merge={slots.merge}
        onRun={props.onRun}
        overview={props.overview}
        pending={props.pending}
        pendingToggles={props.pendingToggles}
        refusal={mergeCardRefusal(props)}
      />
      <ChecksCard
        anchored={slots.anchored.checks}
        onRun={(action) => {
          props.onRun(action, null);
        }}
        overview={props.overview}
        pending={props.pending}
      />
      <LinkedThreadsCard
        describeThread={props.describeThread}
        links={props.overview.links}
        onOpenThread={props.onOpenThread}
        onUnlink={props.onUnlink}
      />
    </View>
  );
}

function Activity(props: OverviewTabProps): React.JSX.Element {
  return (
    <ActivitySection
      anchored={props.slots.anchored.reviewThreads}
      items={props.activity}
      nowMs={props.nowMs}
      onLoadMore={props.onLoadMoreActivity}
      onRun={(action) => {
        props.onRun(action, null);
      }}
      pending={props.pending}
    />
  );
}

const styles = StyleSheet.create({
  column: {
    gap: spacing.xs,
  },
  columns: {
    columnGap: spacing.md,
    flexDirection: "row",
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  rail: {
    gap: spacing.xs,
    width: RAIL_WIDTH,
  },
  workColumn: {
    flex: 1,
    minWidth: 0,
  },
});
