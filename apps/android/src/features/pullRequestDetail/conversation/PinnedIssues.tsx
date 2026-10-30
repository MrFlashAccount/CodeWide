import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View, type ViewStyle } from "react-native";

import type { IssueState, ReviewThreadId } from "../../../data/forgeConversationContract";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { MessageAvatar } from "../../messageContent/MessageAvatar";
import { overviewStyles } from "../overview/overview.styles";
import { AgentThreadButton } from "./AgentThreadButton";
import { conversationStyles } from "./conversation.styles";
import { anchorLabel, firstLine, issueBadge } from "./conversationContent";
import type { DiscussionIssue } from "./discussionModel";

/** What the pinned issues render; the section owns the data and the intents. */
export type PinnedIssuesProps = {
  readonly addressing: Readonly<Record<string, true>>;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onReveal: (threadId: ReviewThreadId) => void;
  readonly open: readonly DiscussionIssue[];
  readonly settled: readonly DiscussionIssue[];
};

const CLOSER_VERBS: Readonly<Record<IssueState, string>> = {
  dropped: "dropped",
  open: "reopened",
  resolved: "resolved",
};

/**
 * The issues of the pull request, pinned above the timeline: one compact row
 * per issue (status dot, author avatar, anchor, first line, who settled it),
 * open issues first, each list newest first. Resolved and dropped issues
 * collapse behind a counter.
 * A row reveals its thread; each row also hands its thread to the agent.
 */
export function PinnedIssues(props: PinnedIssuesProps): React.JSX.Element {
  const [showSettled, setShowSettled] = useState(false);
  const settledCount = props.settled.length;
  return (
    <View style={conversationStyles.frame} testID="discussion-issues">
      {props.open.map((issue, index) => (
        <IssueRow first={index === 0} issue={issue} key={issue.thread.id} {...props} />
      ))}
      {settledCount === 0 ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showSettled }}
          onPress={() => {
            setShowSettled(!showSettled);
          }}
          style={({ pressed }) => [
            overviewStyles.cardLine,
            props.open.length === 0 && styles.first,
            pressed && styles.pressed,
          ]}
          testID="discussion-settled-toggle"
        >
          <Text style={[overviewStyles.meta, overviewStyles.fill]}>
            {`${String(settledCount)} resolved or dropped`}
          </Text>
          <Ionicons
            color={colors.textMuted}
            name={showSettled ? "chevron-up" : "chevron-down"}
            size={iconSize.inline}
          />
        </Pressable>
      )}
      {showSettled
        ? props.settled.map((issue) => (
            <IssueRow first={false} issue={issue} key={issue.thread.id} {...props} />
          ))
        : null}
    </View>
  );
}

function IssueRow({
  addressing,
  first,
  issue,
  onAddressThread,
  onReveal,
}: PinnedIssuesProps & {
  /** The frame's first line draws no divider above itself. */
  readonly first: boolean;
  readonly issue: DiscussionIssue;
}): React.JSX.Element {
  const { state, thread } = issue;
  const [opening] = thread.comments;
  const location = anchorLabel(thread.anchor);
  const preview = firstLine(opening.body);
  const closer = closerOf(issue);
  const testID = `discussion-issue-${thread.id}`;
  return (
    <View style={[overviewStyles.cardLine, styles.row, first && styles.first]} testID={testID}>
      <Pressable
        accessibilityHint="Shows the issue's thread"
        accessibilityLabel={[issueBadge(state).label, location, preview, closer]
          .filter((part) => part !== null && part.length > 0)
          .join(", ")}
        accessibilityRole="button"
        onPress={() => {
          onReveal(thread.id);
        }}
        style={({ pressed }) => [styles.reveal, pressed && styles.pressed]}
        testID={`${testID}-reveal`}
      >
        <View style={[styles.dot, DOT_STYLES[state]]} />
        <MessageAvatar avatarUrl={opening.author.avatarUrl} login={opening.author.login} />
        <IssueSummary closer={closer} location={location} preview={preview} />
      </Pressable>
      <AgentThreadButton
        onPress={() => {
          onAddressThread(thread.id);
        }}
        pending={addressing[thread.id] === true}
        testID={`${testID}-address`}
      />
    </View>
  );
}

/** The issue's anchor, its first line and who settled it, one line each. */
function IssueSummary({
  closer,
  location,
  preview,
}: {
  readonly closer: string | null;
  readonly location: string;
  readonly preview: string;
}): React.JSX.Element {
  return (
    <View style={overviewStyles.fill}>
      <Text ellipsizeMode="middle" numberOfLines={1} style={overviewStyles.code}>
        {location}
      </Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.preview}>
        {preview}
      </Text>
      {closer === null ? null : (
        <Text numberOfLines={1} style={overviewStyles.meta}>
          {closer}
        </Text>
      )}
    </View>
  );
}

/** `resolved by arc-robot`, when the forge says who last changed the state. */
function closerOf({ state, thread }: DiscussionIssue): string | null {
  const { resolution } = thread;
  if (resolution.kind !== "issue" || resolution.changedBy === null) {
    return null;
  }
  return `${CLOSER_VERBS[state]} by ${resolution.changedBy.login}`;
}

const DOT_SIZE = 8;

const styles = StyleSheet.create({
  dot: {
    borderRadius: radii.pill,
    flexShrink: 0,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
  dotDropped: {
    backgroundColor: colors.textDim,
  },
  dotOpen: {
    backgroundColor: colors.red,
  },
  dotResolved: {
    backgroundColor: colors.green,
  },
  // The first line of the frame draws no divider above itself.
  first: {
    borderTopWidth: 0,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  preview: {
    ...typeScale.body,
    color: colors.text,
  },
  reveal: {
    alignItems: "center",
    columnGap: spacing.xs,
    flex: 1,
    flexDirection: "row",
    minHeight: controlSize.touch,
    minWidth: 0,
  },
  row: {
    columnGap: spacing.xs,
  },
});

/** Open red, resolved green, dropped grey; the state is also spoken and shown as the closer. */
const DOT_STYLES: Readonly<Record<IssueState, ViewStyle>> = {
  dropped: styles.dotDropped,
  open: styles.dotOpen,
  resolved: styles.dotResolved,
};
