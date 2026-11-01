import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ReviewThreadId } from "../../../data/forgeConversationContract";
import { DirectImageSourcesProvider } from "../../../rendering/directImageSources";
import { colors, controlSize, spacing, typeScale, typeWeight } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { SectionBand } from "../sections/SectionBand";
import { DiscussionTimeline, type TimelineContext } from "./DiscussionTimeline";
import type { Discussion } from "./discussionModel";
import type { DiscussionNavigator } from "./discussionNavigator";
import type { ConversationWrites } from "./useConversationWrites";
import type { PullRequestConversation } from "./usePullRequestConversation";

/** Everything the Conversation section renders; the screen owns data and intents. */
export type ConversationSectionProps = {
  readonly addressing: Readonly<Record<string, true>>;
  readonly anchored: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly conversation: Exclude<PullRequestConversation, { readonly status: "unsupported" }>;
  /** The loaded pages' projection; `null` until the first page is ready. */
  readonly discussion: Discussion | null;
  /** The page's owner of thread expansion and reveal, shared with the Issues status row. */
  readonly navigator: DiscussionNavigator;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly writes: ConversationWrites;
};

const LOADING_PLACEHOLDER_HEIGHT = 104;

/**
 * The Conversation band with the loaded comment count and its order, then
 * the timeline newest first as full-width items and "Show more discussion"
 * at its end, loading older entries below. New top-level comments come from
 * the floating Comment button. Bodies use the shared complete-document
 * renderer.
 */
export function ConversationSection(props: ConversationSectionProps): React.JSX.Element {
  const { discussion } = props;
  return (
    <View testID="pull-request-conversation">
      <SectionBand
        count={discussion === null ? null : String(discussion.commentCount)}
        testID="pull-request-discussion-heading"
        title="Conversation"
        trailing={<Text style={styles.order}>Newest first</Text>}
      />
      <ConversationBody {...props} />
    </View>
  );
}

function ConversationBody(props: ConversationSectionProps): React.JSX.Element {
  const { conversation, discussion } = props;
  if (conversation.status === "failed") {
    return (
      <View style={styles.note}>
        <Text style={styles.noteText}>{conversation.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={conversation.retry}
          style={styles.action}
          testID="pull-request-discussion-retry"
        >
          <Text style={styles.actionLabel}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (conversation.status === "loading" || discussion === null) {
    return (
      <View
        accessibilityLabel="Conversation is loading"
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
    navigator: props.navigator,
    nowMs: props.nowMs,
    onAddressThread: props.onAddressThread,
    onRun: props.onRun,
    pending: props.pending,
    resolveEnabled: conversation.resolveEnabled,
    writes: props.writes,
  };
  return (
    <DirectImageSourcesProvider sources={conversation.images}>
      {discussion.timeline.length === 0 ? (
        <View style={styles.note}>
          <Text style={styles.noteText}>No conversation yet.</Text>
        </View>
      ) : null}
      <DiscussionTimeline context={context} items={discussion.timeline} />
      {conversation.loadMore === null ? null : (
        <Pressable
          accessibilityRole="button"
          onPress={conversation.loadMore}
          style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          testID="pull-request-discussion-more"
        >
          <Text style={styles.actionLabel}>Show more discussion</Text>
        </Pressable>
      )}
    </DirectImageSourcesProvider>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: controlSize.touch,
  },
  actionLabel: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  more: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: controlSize.touch,
  },
  note: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noteText: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  order: {
    ...typeScale.label,
    color: colors.textDim,
  },
  placeholder: {
    backgroundColor: colors.surfaceContainer,
    height: LOADING_PLACEHOLDER_HEIGHT,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
});
