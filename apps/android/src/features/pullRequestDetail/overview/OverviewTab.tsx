import { useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import type {
  ActivityItem,
  PullRequestOverview,
  PullRequestRow,
} from "../../../data/forgePullRequestContract";
import { useConstant } from "../../../react/useConstant";
import { controlSize, spacing } from "../../../theme";
import type { ActionSlots } from "../actions/actionSlotting";
import { ConversationSection } from "../conversation/ConversationSection";
import { projectDiscussion, type Discussion } from "../conversation/discussionModel";
import {
  createDiscussionNavigator,
  type DiscussionNavigator,
} from "../conversation/discussionNavigator";
import type { ConversationWrites } from "../conversation/useConversationWrites";
import type { PullRequestConversation } from "../conversation/usePullRequestConversation";
import type { ActionNotice, ChangesView } from "../pullRequestScreenModel";
import { SectionBand } from "../sections/SectionBand";
import { StatusSection } from "../sections/StatusSection";
import { ActionNoticeBanner } from "./ActionNoticeBanner";
import { ActionRow } from "./ActionRow";
import { ActivitySection } from "./ActivitySection";
import { DescriptionSection } from "./DescriptionSection";
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
 * Details is one reading column at every width: the PR's status and actions,
 * the description, then full-width banded sections: Changes (Files changed
 * and the review guide), Status (issues, reviews, checks and the merge
 * state) and the Conversation (or, without `forge.conversation@1`, the
 * activity list). The page owns the conversation's projection and the
 * thread navigator, so the Issues row can reveal a thread below it.
 */
export function OverviewTab(props: OverviewTabProps): React.JSX.Element {
  const scroll = useRef<ScrollView>(null);
  const content = useRef<View>(null);
  const navigator = useConstant(() =>
    createDiscussionNavigator({ content, contentOffset: PAGE_TOP, scroll }),
  );
  const discussion =
    props.conversation.status === "ready" ? projectDiscussion(props.conversation.page) : null;
  return (
    <ScrollView contentContainerStyle={styles.content} ref={scroll} testID="pull-request-overview">
      <View ref={content} style={styles.page}>
        <WorkHeader {...props} />
        <Description description={props.overview.description} />
        <ChangesSection {...props} />
        <StatusSection
          addressing={props.addressing}
          discussion={discussion}
          host={props.host}
          nowMs={props.nowMs}
          onAddressThread={props.onAddressThread}
          onReveal={navigator.reveal}
          onRun={props.onRun}
          overview={props.overview}
          pending={props.pending}
          pendingToggles={props.pendingToggles}
          slots={props.slots}
        />
        <Activity {...props} discussion={discussion} navigator={navigator} />
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

/** The Changes band and its rows into Files changed and the review guide. */
function ChangesSection(props: OverviewTabProps): React.JSX.Element {
  return (
    <View>
      <SectionBand testID="pull-request-changes-band" title="Changes" />
      <ReviewLinks
        draftCount={props.draftCount}
        onOpen={props.onOpenChanges}
        stats={props.overview.stats}
      />
    </View>
  );
}

/** Status, the action row and its notices. */
function WorkHeader(props: OverviewTabProps): React.JSX.Element {
  return (
    <View style={[styles.inset, styles.header, styles.lead]}>
      <StatusHeader listRow={props.listRow} nowMs={props.nowMs} overview={props.overview} />
      <ActionRow
        onLayoutWidth={props.onActionRowWidth}
        onRun={(action) => {
          props.onRun(action, null);
        }}
        pending={props.pending}
        slots={props.slots}
      />
      <ActionNoticeBanner host={props.host} notice={props.notice} />
    </View>
  );
}

function Activity(
  props: OverviewTabProps & {
    readonly discussion: Discussion | null;
    readonly navigator: DiscussionNavigator;
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
        pending={props.pending}
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
const PAGE_TOP = spacing.md;

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
  },
  inset: {
    paddingHorizontal: spacing.md,
  },
  // Space under the lead content; the banded sections below sit flush on each other.
  lead: {
    paddingBottom: spacing.lg,
  },
  page: {
    alignSelf: "center",
    maxWidth: READING_MAX_WIDTH,
    width: "100%",
  },
});
