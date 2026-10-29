import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ConversationReviewThread } from "../../../data/forgeConversationContract";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { AppText as Text } from "../../../ui/Typography";
import { MessageCard } from "../../messageContent/MessageCard";
import type { MessageSendResult } from "../../messageContent/messageContent";
import { MessageReplyInput } from "../../messageContent/MessageReplyInput";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { AgentThreadButton } from "./AgentThreadButton";
import { conversationStyles } from "./conversation.styles";
import {
  anchorLabel,
  commentContent,
  commentReactions,
  issueBadge,
  messageAuthor,
} from "./conversationContent";
import { threadSettled } from "./discussionModel";
import type { DiscussionNavigator } from "./discussionNavigator";

/** Everything one review thread renders; the screen owns data and intents. */
export type ReviewThreadCardProps = {
  readonly actions: readonly ActionDescriptor[];
  readonly addressing: boolean;
  /** `forge.comments@1` is declared, so replies can be published. */
  readonly commentsEnabled: boolean;
  /** The largest iteration number on the page; an older iteration chip is muted. */
  readonly latestIteration: number | null;
  readonly navigator: DiscussionNavigator;
  readonly nowMs: number;
  readonly onAddress: () => void;
  readonly onReply: (markdown: string) => Promise<MessageSendResult>;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  readonly thread: ConversationReviewThread;
};

function commentCount(thread: ConversationReviewThread): string {
  return thread.comments.length === 1 ? "1 comment" : `${String(thread.comments.length)} comments`;
}

/** The resolution badge: an issue's state, or Resolved for a resolved conversation. */
function resolutionBadge(thread: ConversationReviewThread): React.JSX.Element | null {
  const { resolution } = thread;
  if (resolution.kind === "issue") {
    const badge = issueBadge(resolution.state);
    return <CaptionBadge label={badge.label} tone={badge.tone} />;
  }
  if (resolution.kind === "conversation" && resolution.resolved) {
    return <CaptionBadge label="Resolved" tone="success" />;
  }
  return null;
}

/** The spoken state after the location, for example ", open issue, iteration 2, outdated". */
function spokenState(thread: ConversationReviewThread): string {
  const { iteration, resolution } = thread;
  const parts: string[] = [];
  if (resolution.kind === "issue") {
    parts.push(issueBadge(resolution.state).label.toLowerCase());
  } else if (resolution.kind === "conversation" && resolution.resolved) {
    parts.push("resolved");
  }
  if (iteration !== null) {
    parts.push(`iteration ${String(iteration.number)}`);
  }
  if (thread.outdated) {
    parts.push("outdated");
  }
  return parts.map((part) => `, ${part}`).join("");
}

/**
 * A review thread: its anchor (`file:line`, file or the pull request) with the
 * issue or resolved state, the iteration it was written on and the outdated
 * mark; every comment; the anchored catalog actions plus "Address in agent";
 * and a reply input. A settled thread (resolved, or a resolved or dropped issue)
 * starts collapsed; its expansion lives in the section's navigator, so the
 * pinned issues can open it.
 */
export function ReviewThreadCard(props: ReviewThreadCardProps): React.JSX.Element {
  const { navigator, thread } = props;
  const explicit = useSelector(() => navigator.expanded(thread.id));
  const expanded = explicit ?? !threadSettled(thread);
  const testID = `review-thread-${thread.id}`;
  return (
    <View
      ref={(view) => navigator.attach(thread.id, view)}
      style={conversationStyles.frame}
      testID={testID}
    >
      <ThreadHeader
        expanded={expanded}
        latestIteration={props.latestIteration}
        onToggle={() => {
          navigator.setExpanded(thread.id, !expanded);
        }}
        testID={`${testID}-toggle`}
        thread={thread}
      />
      {expanded ? <ThreadBody {...props} testID={testID} /> : null}
    </View>
  );
}

function ThreadHeader({
  expanded,
  latestIteration,
  onToggle,
  testID,
  thread,
}: {
  readonly expanded: boolean;
  readonly latestIteration: number | null;
  readonly onToggle: () => void;
  readonly testID: string;
  readonly thread: ConversationReviewThread;
}): React.JSX.Element {
  const location = anchorLabel(thread.anchor);
  const { iteration } = thread;
  return (
    <Pressable
      accessibilityHint={expanded ? "Collapses the thread" : "Shows every comment"}
      accessibilityLabel={`${location}${spokenState(thread)}`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      testID={testID}
    >
      <Ionicons
        color={colors.textMuted}
        name={
          thread.anchor.kind === "pullRequest"
            ? "git-pull-request-outline"
            : "document-text-outline"
        }
        size={iconSize.inline}
      />
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.location}>
        {location}
      </Text>
      {resolutionBadge(thread)}
      {iteration === null ? null : (
        <IterationChip latest={iteration.number === latestIteration} number={iteration.number} />
      )}
      {thread.outdated ? <CaptionBadge label="Outdated" tone="warning" /> : null}
      {expanded ? null : <Text style={styles.count}>{commentCount(thread)}</Text>}
      <Ionicons
        color={colors.textMuted}
        name={expanded ? "chevron-up" : "chevron-down"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

/** The iteration a thread was written on; muted unless it is the newest one on the page. */
function IterationChip({
  latest,
  number,
}: {
  readonly latest: boolean;
  readonly number: number;
}): React.JSX.Element {
  return (
    <View style={[styles.iteration, latest ? null : styles.iterationOlder]}>
      <Text
        numberOfLines={1}
        style={[styles.iterationLabel, latest ? null : styles.iterationLabelOlder]}
      >
        {`Iteration ${String(number)}`}
      </Text>
    </View>
  );
}

function ThreadBody(props: ReviewThreadCardProps & { readonly testID: string }): React.JSX.Element {
  const { thread } = props;
  return (
    <>
      {thread.comments.map((comment) => (
        <MessageCard
          author={messageAuthor(comment.author)}
          content={commentContent(comment)}
          continuation={false}
          createdAt={comment.createdAt}
          divided
          edited={comment.updatedAt !== null}
          key={comment.id}
          nowMs={props.nowMs}
          reactions={commentReactions(comment)}
          testID={`conversation-comment-${comment.id}`}
        />
      ))}
      <View style={styles.actions}>
        {props.actions.map((action) => (
          <CatalogActionButton
            action={action}
            key={action.actionId}
            onPress={props.onRun}
            pending={props.pending[action.actionId] === true}
            variant="compact"
          />
        ))}
        <AgentThreadButton
          onPress={props.onAddress}
          pending={props.addressing}
          testID={`${props.testID}-address`}
        />
      </View>
      {props.commentsEnabled && thread.viewerCanReply ? (
        <View style={styles.reply}>
          <MessageReplyInput
            accessibilityLabel={`Reply on ${anchorLabel(thread.anchor)}`}
            onSend={props.onReply}
            placeholder="Reply…"
            testID={`${props.testID}-reply`}
          />
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  actions: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    padding: spacing.sm,
    rowGap: spacing.xs,
  },
  count: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 0,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  iteration: {
    borderColor: colors.textMuted,
    borderRadius: radii.compact,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: spacing.compact,
    paddingVertical: spacing.optical,
  },
  iterationLabel: {
    ...typeScale.caption,
    color: colors.text,
  },
  iterationLabelOlder: {
    color: colors.textDim,
  },
  iterationOlder: {
    borderColor: colors.border,
  },
  location: {
    ...typeScale.code,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  reply: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
});
