import type { Observable } from "@legendapp/state";
import { useRef } from "react";
import { RefreshControl, ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import type { ThreadId } from "../../../data/reviewContract";
import type {
  ActivityItem,
  PullRequestOverview,
  PullRequestRow,
} from "../../../data/forgePullRequestContract";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, spacing } from "../../../theme";
import { PaneBody } from "../../../ui/PaneBody";
import type { ActionSlots } from "../actions/actionSlotting";
import { ConversationSection } from "../conversation/ConversationSection";
import { projectDiscussion, type Discussion } from "../conversation/discussionModel";
import {
  createDiscussionNavigator,
  type DiscussionNavigator,
} from "../conversation/discussionNavigator";
import { useDiscussionRange } from "../conversation/useDiscussionRange";
import type { ConversationWrites } from "../conversation/useConversationWrites";
import type { PullRequestConversation } from "../conversation/usePullRequestConversation";
import type { ChangesView } from "../pullRequestScreenModel";
import { StatusSection } from "../sections/StatusSection";
import { ActionRow } from "./ActionRow";
import { ActivitySection } from "./ActivitySection";
import { AgentSection } from "./AgentSection";
import { ConflictNotice } from "./ConflictNotice";
import { DescriptionSection } from "./DescriptionSection";
import { DetailsReview, type DetailsReviewProps } from "./DetailsReview";
import { ReviewLinks } from "./ReviewLinks";
import { StatusHeader } from "./StatusHeader";
import { VerdictSplitButton } from "./VerdictSplitButton";

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
  readonly nowMs: number;
  readonly onActionRowWidth: (width: number) => void;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onLoadMoreActivity: (() => void) | null;
  /** Opens a nested review route over Details. */
  readonly onOpenChanges: (view: ChangesView) => void;
  /** Opens an agent run's chat, or the PR's review chat when the run's thread is not known. */
  readonly onOpenReviewChat: (threadId: ThreadId | null) => void;
  /** Pull-to-refresh: re-reads everything the page shows while it stays visible. */
  readonly onPullRefresh: () => void;
  readonly onRun: (action: ActionDescriptor, input: boolean | string | null) => void;
  readonly overview: PullRequestOverview;
  readonly pending: Readonly<Record<string, true>>;
  readonly pendingToggles: Readonly<Record<string, boolean>>;
  /** A pull refresh is running; the indicator stays until its reads settle. */
  readonly pullRefreshing: boolean;
  /** Submit review from Details: the verdict button, its outcome and the Submit sheet. */
  readonly review: DetailsReviewProps;
  readonly slots: ActionSlots;
  readonly writes: ConversationWrites;
};

/** Keeps description lines readable when the PR pane spans an unfolded screen. */
const READING_MAX_WIDTH = 760;

/**
 * Details is one reading column at every width: the PR's status and actions,
 * the description, then full-width links to Files changed and the review
 * guide, Status (issues, reviews, checks and the merge
 * state) and the Conversation (or, without `forge.conversation@1`, the
 * activity list). The page owns the conversation's projection and the
 * thread navigator, so the Issues row can reveal a thread below it.
 */
export function OverviewTab(props: OverviewTabProps): React.JSX.Element {
  return (
    <PaneBody keepScrollEnd key={props.overview.pullRequest}>
      <OverviewReadingColumn {...props} />
    </PaneBody>
  );
}

function OverviewReadingColumn(props: OverviewTabProps): React.JSX.Element {
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const navigator = useConstant(() =>
    createDiscussionNavigator({ content, contentOffset: PAGE_TOP, scroll }),
  );
  const discussion =
    props.conversation.status === "ready" ? projectDiscussion(props.conversation.page) : null;
  const range = useDiscussionRange(discussion, PAGE_TOP);
  const reveal = useEvent((id: ReviewThreadId) => {
    range.includeThread(id);
    navigator.reveal(id);
  });
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      onContentSizeChange={range.onContentSizeChange}
      onLayout={range.onLayout}
      onScroll={range.onScroll}
      ref={scroll}
      refreshControl={
        <RefreshControl
          colors={[colors.accent]}
          onRefresh={props.onPullRefresh}
          progressBackgroundColor={colors.surfaceContainerHigh}
          refreshing={props.pullRefreshing}
          testID="pull-request-overview-refresh"
        />
      }
      scrollEventThrottle={80}
      testID="pull-request-overview"
    >
      <View ref={content} style={styles.page}>
        <WorkHeader {...props} />
        <Description description={props.overview.description} />
        <ReviewLinks
          draftCount={props.draftCount}
          onOpen={props.onOpenChanges}
          stats={props.overview.stats}
        />
        <StatusSection
          addressing={props.addressing}
          discussion={discussion}
          host={props.host}
          nowMs={props.nowMs}
          onAddressThread={props.onAddressThread}
          onReveal={reveal}
          onRun={props.onRun}
          overview={props.overview}
          pending={props.pending}
          pendingToggles={props.pendingToggles}
          slots={props.slots}
        />
        <Activity
          {...props}
          discussion={discussion}
          navigator={navigator}
          onSectionLayout={range.onSectionLayout}
          visibleCount={range.count}
        />
      </View>
    </ScrollView>
  );
}

/** The description under the header, inset like it; nothing when the PR has none. */
function Description({ description }: { readonly description: string }): React.JSX.Element | null {
  if (description.trim().length === 0) {
    return null;
  }
  return (
    <View style={[styles.inset, styles.lead]}>
      <DescriptionSection description={description} />
    </View>
  );
}

/** Status, the verdict button, the forge action row, the Agent section. */
function WorkHeader(props: OverviewTabProps): React.JSX.Element {
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    props.onActionRowWidth(event.nativeEvent.layout.width);
  });
  const run = useEvent((action: ActionDescriptor): void => {
    props.onRun(action, null);
  });
  return (
    <View
      onLayout={onLayout}
      style={[styles.header, styles.lead]}
      testID="pull-request-work-header"
    >
      <StatusHeader listRow={props.listRow} nowMs={props.nowMs} overview={props.overview}>
        {props.review.choice.kind === "prominent" ? (
          <VerdictSplitButton
            lead={props.review.choice.lead}
            onSelect={props.review.onSelect}
            pending={props.review.pending}
            verdicts={props.review.choice.verdicts}
          />
        ) : null}
      </StatusHeader>
      <ConflictNotice
        actions={props.slots.anchored.conflict}
        onRun={run}
        overview={props.overview}
        pending={props.pending}
      />
      <DetailsReview {...props.review} />
      <ActionRow onRun={run} pending={props.pending} slots={props.slots} />
      <AgentSection
        actions={props.slots.agent}
        nowMs={props.nowMs}
        onOpenChat={props.onOpenReviewChat}
        onRun={run}
        pending={props.pending}
      />
    </View>
  );
}

function Activity(
  props: OverviewTabProps & {
    readonly discussion: Discussion | null;
    readonly navigator: DiscussionNavigator;
    readonly onSectionLayout: (event: LayoutChangeEvent) => void;
    readonly visibleCount: Observable<number>;
  },
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
        discussion={props.discussion}
        navigator={props.navigator}
        nowMs={props.nowMs}
        onAddressThread={props.onAddressThread}
        onRun={runAnchored}
        onSectionLayout={props.onSectionLayout}
        pending={props.pending}
        visibleCount={props.visibleCount}
        writes={props.writes}
      />
    );
  }
  return (
    <View style={[styles.inset, styles.activity]}>
      <ActivitySection
        anchored={props.slots.anchored.reviewThreads}
        items={props.activity}
        nowMs={props.nowMs}
        onLoadMore={props.onLoadMoreActivity}
        onRun={runAnchored}
        pending={props.pending}
      />
    </View>
  );
}

/** Where the page starts inside the scroll view; a revealed thread is measured from the page. */
const PAGE_TOP = spacing.xs;

/**
 * Space below the last entry for the floating Comment and linked-chat buttons
 * (48dp, 24dp above the edge) and a step of air, so nothing stays covered.
 */
const FLOATING_ACTIONS_CLEARANCE = spacing.lg + controlSize.touch + spacing.md;

const styles = StyleSheet.create({
  activity: {
    paddingTop: spacing.lg,
  },
  content: {
    paddingBottom: FLOATING_ACTIONS_CLEARANCE,
    paddingTop: PAGE_TOP,
  },
  header: {
    gap: spacing.sm,
    marginHorizontal: spacing.md,
  },
  inset: {
    paddingHorizontal: spacing.md,
  },
  // Space under the lead content; the banded sections below sit flush on each other.
  lead: {
    paddingBottom: spacing.md,
  },
  page: {
    alignSelf: "center",
    maxWidth: READING_MAX_WIDTH,
    width: "100%",
  },
});
