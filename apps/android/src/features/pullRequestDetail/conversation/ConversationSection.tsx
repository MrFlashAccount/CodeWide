import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import { useConstant } from "../../../react/useConstant";
import { DirectImageSourcesProvider } from "../../../rendering/directImageSources";
import { colors, radii, spacing, typeScale } from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { AppText as Text } from "../../../ui/Typography";
import { MessageReplyInput } from "../../messageContent/MessageReplyInput";
import { CardNote } from "../overview/CardHeader";
import { overviewStyles } from "../overview/overview.styles";
import { conversationStyles } from "./conversation.styles";
import { DiscussionTimeline, type TimelineContext } from "./DiscussionTimeline";
import { projectDiscussion, type Discussion } from "./discussionModel";
import {
  createDiscussionNavigator,
  type DiscussionNavigator,
  type RevealTarget,
} from "./discussionNavigator";
import { PinnedIssues } from "./PinnedIssues";
import type { ConversationWrites } from "./useConversationWrites";
import type { PullRequestConversation } from "./usePullRequestConversation";

/** Everything the Discussion renders; the screen owns data and intents. */
export type ConversationSectionProps = {
  readonly addressing: Readonly<Record<string, true>>;
  readonly anchored: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly conversation: Exclude<PullRequestConversation, { readonly status: "unsupported" }>;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  /** The Details page's scroll view; a pinned issue scrolls it to its thread. */
  readonly revealTarget: RevealTarget;
  readonly writes: ConversationWrites;
};

const LOADING_PLACEHOLDER_HEIGHT = 104;

/**
 * The Discussion section after the description, set apart by a divider: a
 * heading with the comment count and a summary chip, the pinned issues (only
 * when the forge reports issues), a new-comment input when the plugin
 * declares `forge.comments@1`, then the timeline newest first with "Show more
 * discussion" at its end loading older entries. Bodies use the shared
 * complete-document renderer.
 */
export function ConversationSection(props: ConversationSectionProps): React.JSX.Element {
  const { conversation, revealTarget } = props;
  const navigator = useConstant(() => createDiscussionNavigator(revealTarget));
  const discussion = conversation.status === "ready" ? projectDiscussion(conversation.page) : null;
  return (
    <View style={styles.section} testID="pull-request-conversation">
      <DiscussionHeading discussion={discussion} />
      <DiscussionBody {...props} discussion={discussion} navigator={navigator} />
    </View>
  );
}

function DiscussionHeading({
  discussion,
}: {
  readonly discussion: Discussion | null;
}): React.JSX.Element {
  const summary = discussion?.summary ?? null;
  return (
    <View style={styles.heading} testID="pull-request-discussion-heading">
      <Text accessibilityRole="header" style={styles.title}>
        Discussion
      </Text>
      {discussion === null ? null : (
        <Text
          accessibilityLabel={`${String(discussion.commentCount)} comments`}
          style={styles.count}
          testID="pull-request-discussion-count"
        >
          {String(discussion.commentCount)}
        </Text>
      )}
      {summary === null ? null : (
        <View style={styles.summary}>
          <CaptionBadge
            label={summary.label}
            testID="pull-request-discussion-summary"
            tone={summary.tone}
          />
        </View>
      )}
    </View>
  );
}

function DiscussionBody(
  props: ConversationSectionProps & {
    readonly discussion: Discussion | null;
    readonly navigator: DiscussionNavigator;
  },
): React.JSX.Element {
  const { conversation, discussion, navigator } = props;
  if (conversation.status === "failed") {
    return (
      <View style={conversationStyles.frame}>
        <CardNote text={conversation.message} />
        <Text
          accessibilityRole="button"
          onPress={conversation.retry}
          style={[overviewStyles.cardLine, overviewStyles.meta]}
        >
          Try again
        </Text>
      </View>
    );
  }
  if (conversation.status === "loading" || discussion === null) {
    return (
      <View
        accessibilityLabel="Discussion is loading"
        accessibilityState={{ busy: true }}
        style={styles.placeholder}
        testID="pull-request-conversation-loading"
      />
    );
  }
  const context: TimelineContext = {
    addressing: props.addressing,
    anchored: props.anchored,
    commentsEnabled: conversation.commentsEnabled,
    latestIteration: discussion.latestIteration,
    navigator,
    nowMs: props.nowMs,
    onAddressThread: props.onAddressThread,
    onRun: props.onRun,
    pending: props.pending,
    writes: props.writes,
  };
  const hasIssues = discussion.openIssues.length + discussion.settledIssues.length > 0;
  return (
    <DirectImageSourcesProvider sources={conversation.images}>
      {hasIssues ? (
        <PinnedIssues
          addressing={props.addressing}
          onAddressThread={props.onAddressThread}
          onReveal={navigator.reveal}
          open={discussion.openIssues}
          settled={discussion.settledIssues}
        />
      ) : null}
      {conversation.commentsEnabled ? (
        <MessageReplyInput
          accessibilityLabel="Comment on this pull request"
          onSend={props.writes.comment}
          placeholder="Add a comment…"
          testID="pull-request-new-comment"
        />
      ) : null}
      {discussion.timeline.length === 0 ? <CardNote text="No discussion yet." /> : null}
      <DiscussionTimeline context={context} items={discussion.timeline} />
      {conversation.loadMore === null ? null : (
        <Text
          accessibilityRole="button"
          onPress={conversation.loadMore}
          style={[overviewStyles.cardLine, overviewStyles.meta]}
          testID="pull-request-discussion-more"
        >
          Show more discussion
        </Text>
      )}
    </DirectImageSourcesProvider>
  );
}

const styles = StyleSheet.create({
  count: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  heading: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  placeholder: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    height: LOADING_PLACEHOLDER_HEIGHT,
  },
  // A divider and a step of space keep the description from running into the comments.
  section: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  summary: {
    flexShrink: 1,
    marginLeft: "auto",
  },
  title: {
    ...typeScale.title,
    color: colors.text,
  },
});
