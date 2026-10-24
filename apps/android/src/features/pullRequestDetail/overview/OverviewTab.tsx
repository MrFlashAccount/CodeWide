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
import { ConflictBanner } from "./ConflictBanner";
import { DescriptionSection } from "./DescriptionSection";
import type { LinkedThreadDescription } from "../linkedThreadDescription";
import { ReadinessPanel } from "./ReadinessPanel";
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
  readonly onOpenReviewChat: () => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: ActionSlots;
  readonly tablet: boolean;
};

const RAIL_WIDTH = 328;

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
 * Details is an editorial work surface, not a grid of unrelated cards. The
 * description and activity form the reading column; merge readiness, checks
 * and the linked conversation share one restrained rail.
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
    <View style={styles.page}>
      <WorkHeader {...props} />
      <DescriptionSection description={props.overview.description} />
      <RailCards {...props} />
      <Activity {...props} />
    </View>
  );
}

function TabletColumns(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={styles.page}>
      <WorkHeader {...props} />
      <View style={styles.columns}>
        <ReadingColumn {...props} />
        <ReadinessColumn {...props} />
      </View>
    </View>
  );
}

function ReadinessColumn(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={styles.rail}>
      <RailCards {...props} />
    </View>
  );
}

function ReadingColumn(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={[styles.readingColumn, styles.workColumn]}>
      <DescriptionSection description={props.overview.description} />
      <Activity {...props} />
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
    <View style={styles.header}>
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
  return (
    <ReadinessPanel
      describeThread={props.describeThread}
      host={props.host}
      listRow={props.listRow}
      onOpenReviewChat={props.onOpenReviewChat}
      onRun={props.onRun}
      overview={props.overview}
      pending={props.pending}
      pendingToggles={props.pendingToggles}
      slots={props.slots}
    />
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
  columns: {
    alignItems: "flex-start",
    columnGap: spacing.lg,
    flexDirection: "row",
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl + spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  page: {
    gap: spacing.lg,
  },
  rail: {
    width: RAIL_WIDTH,
  },
  readingColumn: {
    gap: spacing.xl,
  },
  workColumn: {
    flex: 1,
    minWidth: 0,
  },
});
