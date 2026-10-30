import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type {
  ConversationReviewThread,
  ReviewThreadId,
} from "../../../data/forgeConversationContract";
import { colors, controlSize, iconSize, spacing } from "../../../theme";
import { CaptionBadge } from "../../../ui/CaptionBadge";
import { compactAge } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { MessageAuthorName } from "../../messageContent/MessageAuthorName";
import { MessageAvatar } from "../../messageContent/MessageAvatar";
import { MessageCard } from "../../messageContent/MessageCard";
import { overviewStyles } from "../overview/overview.styles";
import { conversationStyles } from "./conversation.styles";
import {
  commentContent,
  commentReactions,
  eventRunLabel,
  messageAuthor,
  verdictLabel,
  verdictPhrase,
  verdictTone,
} from "./conversationContent";
import type { EventEntry, ReviewEntry, TimelineItem } from "./discussionModel";
import type { DiscussionNavigator } from "./discussionNavigator";
import { ReviewThreadCard } from "./ReviewThreadCard";
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
  readonly writes: ConversationWrites;
};

/** The Discussion, newest first: comment groups, reviews with their threads, verdicts and events. */
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
    return <ReviewCard context={context} review={item.review} threads={item.threads} />;
  }
  if (item.kind === "verdict") {
    return <VerdictRow nowMs={context.nowMs} review={item.review} />;
  }
  if (item.kind === "thread") {
    return <ThreadEntry context={context} thread={item.thread} />;
  }
  return <EventRun events={item.events} nowMs={context.nowMs} />;
}

/** Top-level comments of one author, newest first: the header once, older comments as continuations. */
function CommentGroup({
  comments,
  nowMs,
}: {
  readonly comments: Extract<TimelineItem, { readonly kind: "comments" }>["comments"];
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <View style={conversationStyles.frame}>
      {comments.map((comment, index) => (
        <MessageCard
          author={messageAuthor(comment.author)}
          content={commentContent(comment)}
          continuation={index > 0}
          createdAt={comment.createdAt}
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

function VerdictBadge({ review }: { readonly review: ReviewEntry }): React.JSX.Element {
  return <CaptionBadge label={verdictLabel(review.verdict)} tone={verdictTone(review.verdict)} />;
}

/** A review with its summary body (if any) and the threads published with it. */
function ReviewCard({
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
    <View style={conversationStyles.frame} testID={`conversation-review-${review.id}`}>
      {body === null ? (
        <View style={styles.reviewHeader} testID={`conversation-review-card-${review.id}`}>
          <MessageAvatar avatarUrl={review.author.avatarUrl} login={review.author.login} />
          <MessageAuthorName author={messageAuthor(review.author)} />
          <VerdictBadge review={review} />
          <Text style={[overviewStyles.meta, styles.age]}>
            {compactAge(review.createdAt, context.nowMs)}
          </Text>
        </View>
      ) : (
        <MessageCard
          author={messageAuthor(review.author)}
          badge={<VerdictBadge review={review} />}
          content={commentContent(body)}
          continuation={false}
          createdAt={review.createdAt}
          divided={false}
          edited={body.updatedAt !== null}
          nowMs={context.nowMs}
          reactions={commentReactions(body)}
          testID={`conversation-review-card-${review.id}`}
        />
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

/** A verdict without text: one quiet line. */
function VerdictRow({
  nowMs,
  review,
}: {
  readonly nowMs: number;
  readonly review: ReviewEntry;
}): React.JSX.Element {
  return (
    <View style={styles.line} testID={`conversation-verdict-${review.id}`}>
      <MessageAvatar avatarUrl={review.author.avatarUrl} login={review.author.login} />
      <MessageAuthorName author={messageAuthor(review.author)} />
      <Text numberOfLines={1} style={[overviewStyles.meta, styles.phrase]}>
        {verdictPhrase(review.verdict)}
      </Text>
      <Text style={[overviewStyles.meta, styles.age]}>{compactAge(review.createdAt, nowMs)}</Text>
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
      onRun={context.onRun}
      pending={context.pending}
      thread={thread}
    />
  );
}

/** One event line: the actor's login and the event's plain text. */
function EventLine({
  event,
  nowMs,
}: {
  readonly event: EventEntry;
  readonly nowMs: number;
}): React.JSX.Element {
  return (
    <View style={styles.event} testID={`conversation-event-${event.id}`}>
      <Text style={[overviewStyles.meta, overviewStyles.fill]}>
        {event.author === null ? event.text : `${event.author.login} ${event.text}`}
      </Text>
      <Text style={overviewStyles.meta}>{compactAge(event.createdAt, nowMs)}</Text>
    </View>
  );
}

/** A single event, or a collapsed run of same-category events that expands in place; the run shows its newest age. */
function EventRun({
  events,
  nowMs,
}: {
  readonly events: Extract<TimelineItem, { readonly kind: "events" }>["events"];
  readonly nowMs: number;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [first] = events;
  if (events.length === 1) {
    return <EventLine event={first} nowMs={nowMs} />;
  }
  const label = eventRunLabel(first.category, events.length);
  return (
    <View testID={`conversation-events-${first.id}`}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpanded(!expanded);
        }}
        style={styles.event}
        testID={`conversation-events-${first.id}-toggle`}
      >
        <Text style={[overviewStyles.meta, overviewStyles.fill]}>{label}</Text>
        <Text style={overviewStyles.meta}>{compactAge(first.createdAt, nowMs)}</Text>
        <Ionicons
          color={colors.textMuted}
          name={expanded ? "chevron-up" : "chevron-down"}
          size={iconSize.inline}
        />
      </Pressable>
      {expanded
        ? events.map((event) => <EventLine event={event} key={event.id} nowMs={nowMs} />)
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  age: {
    flexShrink: 0,
    marginLeft: "auto",
  },
  event: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  line: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  phrase: {
    flexShrink: 1,
  },
  reviewHeader: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  reviewThreads: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
});
