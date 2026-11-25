import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { IssueState, ReviewThreadId } from "../../../data/forgeConversationContract";
import { colors, controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { compactAge } from "../../../ui/relativeAge";
import { AppText as Text } from "../../../ui/Typography";
import { PillButton } from "../sections/PillButton";
import { StatusRow } from "../sections/StatusRow";
import { AgentThreadButton } from "./AgentThreadButton";
import { anchorLabel, firstLine } from "./conversationContent";
import type { DiscussionIssue, StatusSummary } from "./discussionModel";

/** What the Issues row renders; the page owns the data and the intents. */
export type IssuesStatusRowProps = {
  readonly addressing: Readonly<Record<string, true>>;
  readonly divided: boolean;
  readonly nowMs: number;
  readonly onAddressThread: (threadId: ReviewThreadId) => void;
  readonly onReveal: (threadId: ReviewThreadId) => void;
  readonly open: readonly DiscussionIssue[];
  readonly settled: readonly DiscussionIssue[];
  readonly summary: StatusSummary;
};

const CLOSER_VERBS: Readonly<Record<IssueState, string>> = {
  dropped: "dropped",
  open: "reopened",
  resolved: "resolved",
};

/**
 * The Status section's Issues row: `1 open · blocks merge` and, expanded
 * (by default while an issue is open), each open issue newest first with
 * its anchor, first line and who last changed it, "Address in agent" and
 * "View code", which reveals its thread in the conversation. Resolved and
 * dropped issues wait behind a counter.
 */
export function IssuesStatusRow(props: IssuesStatusRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(props.open.length > 0);
  const list = <IssueList {...props} />;
  return (
    <StatusRow
      detail={props.summary.label}
      detailTone="alert"
      disclosure={{
        expanded,
        kind: "expandable",
        onToggle: () => {
          setExpanded(!expanded);
        },
      }}
      divided={props.divided}
      testID="pull-request-status-issues"
      title="Issues"
      tone={props.summary.tone}
    >
      {list}
    </StatusRow>
  );
}

/** Open issues, then the counter that shows the resolved and dropped ones below it. */
function IssueList(props: IssuesStatusRowProps): React.JSX.Element {
  const [showSettled, setShowSettled] = useState(false);
  return (
    <View style={styles.list} testID="discussion-issues">
      {props.open.map((issue) => (
        <IssueItem issue={issue} key={issue.thread.id} {...props} />
      ))}
      {props.settled.length === 0 ? null : (
        <SettledToggle
          count={props.settled.length}
          expanded={showSettled}
          onToggle={() => {
            setShowSettled(!showSettled);
          }}
        />
      )}
      {showSettled
        ? props.settled.map((issue) => <IssueItem issue={issue} key={issue.thread.id} {...props} />)
        : null}
    </View>
  );
}

function SettledToggle({
  count,
  expanded,
  onToggle,
}: {
  readonly count: number;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onToggle}
      style={({ pressed }) => [styles.settled, pressed && styles.pressed]}
      testID="discussion-settled-toggle"
    >
      <Text style={[styles.meta, styles.fill]}>{`${String(count)} resolved or dropped`}</Text>
      <Ionicons
        color={colors.textMuted}
        name={expanded ? "chevron-up" : "chevron-down"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function IssueItem(
  props: IssuesStatusRowProps & { readonly issue: DiscussionIssue },
): React.JSX.Element {
  const { thread } = props.issue;
  const testID = `discussion-issue-${thread.id}`;
  return (
    <View style={styles.item} testID={testID}>
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.location}>
        {anchorLabel(thread.anchor)}
      </Text>
      <Text numberOfLines={2} style={styles.title}>
        {firstLine(thread.comments[0].body)}
      </Text>
      <Text numberOfLines={1} style={styles.meta}>
        {provenanceOf(props.issue, props.nowMs)}
      </Text>
      <IssueActions {...props} testID={testID} />
    </View>
  );
}

/** "Address in agent" hands the issue to the agent; "View code" reveals its thread below. */
function IssueActions({
  addressing,
  issue,
  onAddressThread,
  onReveal,
  testID,
}: IssuesStatusRowProps & {
  readonly issue: DiscussionIssue;
  readonly testID: string;
}): React.JSX.Element {
  const { thread } = issue;
  return (
    <View style={styles.actions}>
      <AgentThreadButton
        onPress={() => {
          onAddressThread(thread.id);
        }}
        pending={addressing[thread.id] === true}
        testID={`${testID}-address`}
      />
      <PillButton
        icon="code-slash"
        label={thread.anchor.kind === "pullRequest" ? "View thread" : "View code"}
        onPress={() => {
          onReveal(thread.id);
        }}
        pending={false}
        testID={`${testID}-reveal`}
        variant="outlined"
      />
    </View>
  );
}

/**
 * `reopened by olga.v · 2d` when the forge says who last changed the state,
 * otherwise who raised it and when: `arc-robot · 3h`.
 */
function provenanceOf({ state, thread }: DiscussionIssue, nowMs: number): string {
  const { resolution } = thread;
  if (resolution.kind === "issue" && resolution.changedBy !== null) {
    const who = `${CLOSER_VERBS[state]} by ${resolution.changedBy.login}`;
    return resolution.changedAt === null
      ? who
      : `${who} · ${compactAge(resolution.changedAt, nowMs)}`;
  }
  const [opening] = thread.comments;
  return `${opening.author.login} · ${compactAge(opening.createdAt, nowMs)}`;
}

const styles = StyleSheet.create({
  actions: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingTop: spacing.xs,
    rowGap: spacing.xs,
  },
  fill: {
    flex: 1,
  },
  item: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.optical,
    paddingTop: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  location: {
    ...typeScale.code,
    color: colors.textDim,
  },
  meta: {
    ...typeScale.label,
    color: colors.textDim,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
  settled: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.touch,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
});
