import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { ConversationReviewThread } from "../../../data/forgeConversationContract";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { anchorLabel } from "./conversationContent";
import { ThreadState } from "./ThreadState";

function commentCount(thread: ConversationReviewThread): string {
  return thread.comments.length === 1 ? "1 comment" : `${String(thread.comments.length)} comments`;
}

/** The spoken state after the location, for example ", open issue, iteration 2, outdated". */
function spokenState(thread: ConversationReviewThread): string {
  const { iteration, resolution } = thread;
  const parts: string[] = [];
  if (resolution.kind === "issue") {
    parts.push(resolution.state === "open" ? "open issue" : resolution.state);
  } else if (resolution.kind === "conversation") {
    parts.push(resolution.resolved ? "resolved" : "unresolved");
  }
  if (iteration !== null) {
    parts.push(`iteration ${String(iteration.number)}`);
  }
  if (thread.outdated) {
    parts.push("outdated");
  }
  return parts.map((part) => `, ${part}`).join("");
}

/** The thread's file header: collapse chevron, anchor, older iteration, outdated mark and state. */
export function ThreadHeader({
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
      style={({ pressed }) => [
        styles.header,
        expanded && styles.headerOpen,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Ionicons
        color={colors.textMuted}
        name={expanded ? "chevron-down" : "chevron-forward"}
        size={iconSize.inline}
      />
      <Text ellipsizeMode="middle" numberOfLines={1} style={styles.location}>
        {location}
      </Text>
      {iteration === null || iteration.number === latestIteration ? null : (
        <OutlinedLabel text={`Iteration ${String(iteration.number)}`} />
      )}
      {thread.outdated ? <OutlinedLabel text="Outdated" /> : null}
      <ThreadState resolution={thread.resolution} />
      {expanded ? null : <Text style={styles.count}>{commentCount(thread)}</Text>}
    </Pressable>
  );
}

function OutlinedLabel({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <View style={styles.outlined}>
      <Text numberOfLines={1} style={styles.outlinedLabel}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  count: {
    ...typeScale.label,
    color: colors.textDim,
    flexShrink: 0,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.xs,
    flexDirection: "row",
    minHeight: controlSize.regular + spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  headerOpen: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  location: {
    ...typeScale.code,
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
  },
  outlined: {
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    flexShrink: 0,
    paddingHorizontal: spacing.xs,
  },
  outlinedLabel: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  pressed: {
    backgroundColor: colors.surfaceContainer,
  },
});
