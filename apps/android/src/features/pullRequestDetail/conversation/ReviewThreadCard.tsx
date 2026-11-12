import { useSelector } from "@legendapp/state/react";
import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ConversationReviewThread } from "../../../data/forgeConversationContract";
import { colors, radii, spacing } from "../../../theme";
import { MessageCard } from "../../messageContent/MessageCard";
import type { MessageSendResult } from "../../messageContent/messageContent";
import { MessageReplyInput } from "../../messageContent/MessageReplyInput";
import { CatalogActionButton } from "../actions/CatalogActionButton";
import { AgentThreadButton } from "./AgentThreadButton";
import { CodeExcerptBlock } from "./CodeExcerptBlock";
import {
  anchorLabel,
  commentContent,
  commentReactions,
  messageAuthor,
} from "./conversationContent";
import { threadSettled } from "./discussionModel";
import type { DiscussionNavigator } from "./discussionNavigator";
import { ResolveConversationButton } from "./ResolveConversationButton";
import { ThreadHeader } from "./ThreadHeader";
import type { ThreadResolveOutcome } from "./useConversationWrites";

/** Everything one review thread renders; the screen owns data and intents. */
export type ReviewThreadCardProps = {
  readonly actions: readonly ActionDescriptor[];
  readonly addressing: boolean;
  /** `forge.comments@1` is declared, so replies can be published. */
  readonly commentsEnabled: boolean;
  /** The largest iteration number on the page; only an older iteration is labelled. */
  readonly latestIteration: number | null;
  readonly navigator: DiscussionNavigator;
  readonly nowMs: number;
  readonly onAddress: () => void;
  readonly onReply: (markdown: string) => Promise<MessageSendResult>;
  readonly onResolve: (resolved: boolean) => Promise<ThreadResolveOutcome>;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  /** `forge.conversation.resolve@1` is declared, so conversations can be resolved. */
  readonly resolveEnabled: boolean;
  readonly thread: ConversationReviewThread;
};

/**
 * A review thread as one surfaced block: a file header (collapse chevron,
 * the anchor in code type, the iteration only when it is not the newest, the
 * issue or resolution state as a dot and a word, the outdated mark), then
 * the code excerpt when the forge sent one, every reply, a reply input, the
 * anchored catalog actions, "Resolve conversation" when the viewer may flip
 * it, and "Address in agent". A settled thread starts collapsed, and one the
 * viewer resolves collapses; its expansion lives in the section's navigator,
 * so the Issues status row can reveal it.
 */
export function ReviewThreadCard(props: ReviewThreadCardProps): React.JSX.Element {
  const { navigator, thread } = props;
  const explicit = useSelector(() => navigator.expanded(thread.id));
  const expanded = explicit ?? !threadSettled(thread);
  const testID = `review-thread-${thread.id}`;
  return (
    <View ref={(view) => navigator.attach(thread.id, view)} style={styles.block} testID={testID}>
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

function ThreadBody(props: ReviewThreadCardProps & { readonly testID: string }): React.JSX.Element {
  const { navigator, thread } = props;
  const { resolution } = thread;
  return (
    <View style={styles.body}>
      {thread.excerpt === null ? null : (
        <View style={styles.excerpt}>
          <CodeExcerptBlock
            anchor={thread.anchor}
            excerpt={thread.excerpt}
            testID={`${props.testID}-excerpt`}
          />
        </View>
      )}
      {thread.comments.map((comment, index) => (
        <MessageCard
          author={messageAuthor(comment.author)}
          content={commentContent(comment)}
          continuation={false}
          createdAt={comment.createdAt}
          density="reply"
          divided={index > 0}
          edited={comment.updatedAt !== null}
          key={comment.id}
          nowMs={props.nowMs}
          reactions={commentReactions(comment)}
          testID={`conversation-comment-${comment.id}`}
        />
      ))}
      {props.commentsEnabled && thread.viewerCanReply ? (
        <MessageReplyInput
          accessibilityLabel={`Reply on ${anchorLabel(thread.anchor)}`}
          onSend={props.onReply}
          placeholder="Reply…"
          testID={`${props.testID}-reply`}
        />
      ) : null}
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
        {props.resolveEnabled &&
        resolution.kind === "conversation" &&
        resolution.viewerCanToggle ? (
          <ResolveConversationButton
            onResolve={props.onResolve}
            onSettled={(resolved) => {
              // A resolved conversation folds away; an unresolved one stays open to work on.
              navigator.setExpanded(thread.id, !resolved);
            }}
            resolved={resolution.resolved}
            testID={`${props.testID}-resolve`}
          />
        ) : null}
        <AgentThreadButton
          onPress={props.onAddress}
          pending={props.addressing}
          testID={`${props.testID}-address`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingBottom: spacing.sm,
    rowGap: spacing.xs,
  },
  block: {
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    overflow: "hidden",
  },
  body: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  excerpt: {
    paddingTop: spacing.sm,
  },
});
