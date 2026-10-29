import { useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import type {
  ActivityItem,
  PullRequestOverview,
  PullRequestRow,
} from "../../../data/forgePullRequestContract";
import { spacing } from "../../../theme";
import type { ActionSlots } from "../actions/actionSlotting";
import { ConversationSection } from "../conversation/ConversationSection";
import type { RevealTarget } from "../conversation/discussionNavigator";
import type { ConversationWrites } from "../conversation/useConversationWrites";
import type { PullRequestConversation } from "../conversation/usePullRequestConversation";
import type { ActionNotice, ChangesView } from "../pullRequestScreenModel";
import { ActionNoticeBanner } from "./ActionNoticeBanner";
import { ActionRow } from "./ActionRow";
import { ActivitySection } from "./ActivitySection";
import { DescriptionSection } from "./DescriptionSection";
import { MergeBox } from "./MergeBox";
import { ReviewLinks } from "./ReviewLinks";
import { StatusHeader } from "./StatusHeader";

/** Everything the Overview tab renders; the screen owns data and intents. */
export type OverviewTabProps = {
  readonly activity: readonly ActivityItem[];
  /** Review threads whose focused agent start is pending. */
  readonly addressing: Readonly<Record<string, true>>;
  /** Replaces the activity list unless it is `unsupported`. */
  readonly conversation: PullRequestConversation;
  /** The PR's unsent review drafts, shown on Files changed. */
  readonly draftCount: number;
  readonly host: string;
  /** The PR's row from a loaded list; `null` on a cold deep link. */
  readonly listRow: PullRequestRow | null;
  readonly notice: ActionNotice | null;
  readonly nowMs: number;
  readonly onActionRowWidth: (width: number) => void;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onLoadMoreActivity: (() => void) | null;
  /** Opens a nested review route over Details. */
  readonly onOpenChanges: (view: ChangesView) => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  readonly slots: ActionSlots;
  readonly writes: ConversationWrites;
};

/** Keeps description lines readable when the PR pane spans an unfolded screen. */
const READING_MAX_WIDTH = 760;

/**
 * Details is one reading column at every width: status and actions, the
 * collapsed merge readiness line (details in its sheet), then the description
 * and the conversation (or, without `forge.conversation@1`, the activity list).
 */
export function OverviewTab(props: OverviewTabProps): React.JSX.Element {
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  return (
    <ScrollView contentContainerStyle={styles.content} ref={scroll} testID="pull-request-overview">
      <View ref={content} style={styles.page}>
        <WorkHeader {...props} />
        <DescriptionSection description={props.overview.description} />
        <Activity {...props} revealTarget={{ content, contentOffset: PAGE_INSET, scroll }} />
      </View>
    </ScrollView>
  );
}

/** Status, the review entries, the action row, its notices and the merge readiness line. */
function WorkHeader(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={styles.header}>
      <StatusHeader listRow={props.listRow} nowMs={props.nowMs} overview={props.overview} />
      <ReviewLinks
        draftCount={props.draftCount}
        onOpen={props.onOpenChanges}
        stats={props.overview.stats}
      />
      <ActionRow
        onLayoutWidth={props.onActionRowWidth}
        onRun={(action) => {
          props.onRun(action, null);
        }}
        pending={props.pending}
        slots={props.slots}
      />
      <ActionNoticeBanner host={props.host} notice={props.notice} />
      <MergeBox
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

function Activity(
  props: OverviewTabProps & { readonly revealTarget: RevealTarget },
): React.JSX.Element {
  const runAnchored = (action: ActionDescriptor): void => {
    props.onRun(action, null);
  };
  if (props.conversation.status !== "unsupported") {
    return (
      <ConversationSection
        addressing={props.addressing}
        anchored={props.slots.anchored.reviewThreads}
        conversation={props.conversation}
        nowMs={props.nowMs}
        onAddressThread={props.onAddressThread}
        onRun={runAnchored}
        pending={props.pending}
        revealTarget={props.revealTarget}
        writes={props.writes}
      />
    );
  }
  return (
    <ActivitySection
      anchored={props.slots.anchored.reviewThreads}
      items={props.activity}
      nowMs={props.nowMs}
      onLoadMore={props.onLoadMoreActivity}
      onRun={runAnchored}
      pending={props.pending}
    />
  );
}

/** The page's inset inside the scroll view; a revealed thread is measured from the page. */
const PAGE_INSET = spacing.md;

const styles = StyleSheet.create({
  content: {
    padding: PAGE_INSET,
    paddingBottom: spacing.xl + spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  page: {
    alignSelf: "center",
    gap: spacing.lg,
    maxWidth: READING_MAX_WIDTH,
    width: "100%",
  },
});
