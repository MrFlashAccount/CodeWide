import { StyleSheet, View } from "react-native";

import type { ThreadUnreadReader } from "../../data/project-unread-model";
import { spacing } from "../../theme";
import type { MessageSendResult } from "../messageContent/messageContent";
import { NewCommentButton } from "./conversation/NewCommentButton";
import type { PullRequestConversation } from "./conversation/usePullRequestConversation";
import { LinkedChatButton } from "./LinkedChatButton";
import type { PullRequestScreenData } from "./usePullRequestScreen";

/** What decides the floating actions; the screen owns the intents. */
type FloatingActionsProps = {
  readonly agentThread: PullRequestScreenData["agentThread"];
  /** The route shows the linked chat beside the PR, so its button is not needed. */
  readonly chatVisible: boolean;
  readonly conversation: PullRequestConversation;
  /** Details shows the Comment pill; Changes does not. */
  readonly details: boolean;
  readonly isThreadUnread: ThreadUnreadReader;
  readonly onComment: (markdown: string) => Promise<MessageSendResult>;
  readonly onOpenChat: () => void;
};

/**
 * The floating actions at the bottom-right edge of the PR screen: the
 * Comment pill on Details while the plugin declares `forge.comments@1`, then
 * the round linked-chat button, side by side so neither covers the other.
 * Details keeps clearance below its last entry.
 */
export function FloatingActions(props: FloatingActionsProps): React.JSX.Element | null {
  const comment = commentsOffered(props);
  if (props.chatVisible && !comment) {
    return null;
  }
  return (
    <View pointerEvents="box-none" style={styles.floating}>
      {comment ? <NewCommentButton onSend={props.onComment} /> : null}
      {props.chatVisible ? null : <ChatButton {...props} />}
    </View>
  );
}

function commentsOffered({ conversation, details }: FloatingActionsProps): boolean {
  return details && conversation.status === "ready" && conversation.commentsEnabled;
}

function ChatButton({
  agentThread,
  isThreadUnread,
  onOpenChat,
}: FloatingActionsProps): React.JSX.Element {
  return (
    <LinkedChatButton
      disabled={false}
      isThreadUnread={isThreadUnread}
      label={
        agentThread === null
          ? "Start linked review chat"
          : `Open linked review chat: ${agentThread.title}`
      }
      onPress={onOpenChat}
      reviewThreadId={agentThread?.threadId ?? null}
    />
  );
}

const styles = StyleSheet.create({
  floating: {
    alignItems: "center",
    bottom: spacing.lg,
    columnGap: spacing.sm,
    flexDirection: "row",
    position: "absolute",
    right: spacing.md,
  },
});
