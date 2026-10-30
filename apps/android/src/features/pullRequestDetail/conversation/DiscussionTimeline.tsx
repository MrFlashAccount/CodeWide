import { StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type {
  ConversationReviewThread,
  ReviewThreadId,
} from "../../../data/forgeConversationContract";
import { colors, spacing } from "../../../theme";
import { MessageCard } from "../../messageContent/MessageCard";
import { commentContent, commentReactions, messageAuthor } from "./conversationContent";
import type { ReviewEntry, TimelineItem } from "./discussionModel";
import type { DiscussionNavigator } from "./discussionNavigator";
import { ReviewThreadCard } from "./ReviewThreadCard";
import { EventLine, EventRun } from "./TimelineEventRow";
import { verdictEvent } from "./timelineEvent";
import type { ConversationWrites } from "./useConversationWrites";

/** What every timeline item needs from the section. */
export type TimelineContext = {
  readonly addressing: Readonly<Record<string, true>>;
  readonly anchored: ReadonlyMap<string, readonly ActionDescriptor[]>;
  readonly commentsEnabled: boolean;
  readonly latestIteration: number | null;
  readonly navigator: DiscussionNavigator;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onRun: (action: ActionDescriptor) => void;
  readonly pending: Readonly<Record<string, true>>;
  /** `forge.conversation.resolve@1` is declared, so conversations can be resolved. */
  readonly resolveEnabled: boolean;
  readonly writes: ConversationWrites;
};

/**
 * The conversation, newest first, as full-width items separated by
 * hairlines: comment groups, reviews (a verdict row, the review's text and
 * its threads), verdict-only rows and event rows. No item draws a card.
 */
export function DiscussionTimeline({
  context,
  items,
}: {
  readonly context: TimelineContext;
  readonly items: readonly TimelineItem[];
}): React.JSX.Element {
  return (
    <>
      {items.map((item) => (
        <Item context={context} item={item} key={item.key} />
      ))}
    </>
  );
}

function Item({
  context,
  item,
}: {
  readonly context: TimelineContext;
  readonly item: TimelineItem;
}): React.JSX.Element {
  if (item.kind === "comments") {
    return <CommentGroup comments={item.comments} nowMs={context.nowMs} />;
  }
  if (item.kind === "review") {
    return <Review context={context} review={item.review} threads={item.threads} />;
  }
  if (item.kind === "verdict") {
    return (
      <EventLine
        event={verdictEvent(item.review)}
        nowMs={context.nowMs}
        testID={`conversation-verdict-${item.review.id}`}
      />
    );
  }
  if (item.kind === "thread") {
    return (
      <View style={styles.threadItem}>
        <ThreadEntry context={context} thread={item.thread} />
      </View>
    );
  }
  return <EventRun events={item.events} nowMs={context.nowMs} />;
}

/** Top-level comments of one author, newest first: the header once, older comments continue below. */
function CommentGroup({
  comments,
  nowMs,
}: {
  readonly comments: Extract<TimelineItem, { readonly kind: "comments" }>["comments"];
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <View style={styles.block}>
      {comments.map((comment, index) => (
        <MessageCard
          author={messageAuthor(comment.author)}
          content={commentContent(comment)}
          continuation={index > 0}
          createdAt={comment.createdAt}
          density="message"
          divided={false}
          edited={comment.updatedAt !== null}
          key={comment.id}
          nowMs={nowMs}
          reactions={commentReactions(comment)}
          testID={`conversation-comment-${comment.id}`}
        />
      ))}
    </View>
  );
}

/** A review: its verdict as a row, its own text below, then the threads published with it. */
function Review({
  context,
  review,
  threads,
}: {
  readonly context: TimelineContext;
  readonly review: ReviewEntry;
  readonly threads: readonly ConversationReviewThread[];
}): React.JSX.Element {
  const { body } = review;
  return (
    <View testID={`conversation-review-${review.id}`}>
      <EventLine
        event={verdictEvent(review)}
        nowMs={context.nowMs}
        testID={`conversation-review-${review.id}-row`}
      />
      {body === null ? null : (
        <View style={styles.reviewBody}>
          <MessageCard
            author={messageAuthor(review.author)}
            content={commentContent(body)}
            continuation
            createdAt={review.createdAt}
            density="message"
            divided={false}
            edited={body.updatedAt !== null}
            nowMs={context.nowMs}
            reactions={commentReactions(body)}
            testID={`conversation-review-card-${review.id}`}
          />
        </View>
      )}
      {threads.length === 0 ? null : (
        <View style={styles.reviewThreads} testID={`conversation-review-${review.id}-threads`}>
          {threads.map((thread) => (
            <ThreadEntry context={context} key={thread.id} thread={thread} />
          ))}
        </View>
      )}
    </View>
  );
}

function ThreadEntry({
  context,
  thread,
}: {
  readonly context: TimelineContext;
  readonly thread: ConversationReviewThread;
}): React.JSX.Element {
  return (
    <ReviewThreadCard
      actions={context.anchored.get(thread.id) ?? []}
      addressing={context.addressing[thread.id] === true}
      commentsEnabled={context.commentsEnabled}
      latestIteration={context.latestIteration}
      navigator={context.navigator}
      nowMs={context.nowMs}
      onAddress={() => {
        context.onAddressThread(thread.id);
      }}
      onReply={async (markdown) => context.writes.reply(thread.id, markdown)}
      onResolve={async (resolved) => context.writes.resolve(thread.id, resolved)}
      onRun={context.onRun}
      pending={context.pending}
      resolveEnabled={context.resolveEnabled}
      thread={thread}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xxs,
  },
  reviewBody: {
    marginTop: -spacing.xs,
    paddingHorizontal: spacing.md,
  },
  reviewThreads: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  threadItem: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
  },
});
