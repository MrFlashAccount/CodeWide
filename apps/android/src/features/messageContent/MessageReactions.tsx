import { StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { MessageReaction } from "./messageContent";

/** Spoken summary of one reaction, so the viewer's own is not conveyed by color alone. */
function reactionLabel(reaction: MessageReaction): string {
  const people = reaction.count === 1 ? "1 reaction" : `${String(reaction.count)} reactions`;
  return reaction.viewerReacted
    ? `${reaction.emoji} ${people}, including yours`
    : `${reaction.emoji} ${people}`;
}

/** Read-only reactions row: emoji and count, the viewer's own reaction highlighted. */
export function MessageReactions({
  reactions,
}: {
  readonly reactions: readonly MessageReaction[];
}): React.JSX.Element | null {
  if (reactions.length === 0) {
    return null;
  }
  return (
    <View style={styles.row}>
      {reactions.map((reaction) => (
        <View
          accessibilityLabel={reactionLabel(reaction)}
          accessible
          key={reaction.key}
          style={[styles.chip, reaction.viewerReacted && styles.chipOwn]}
          testID={`message-reaction-${reaction.key}`}
        >
          <Text style={styles.emoji}>{reaction.emoji}</Text>
          <Text style={[styles.count, reaction.viewerReacted && styles.countOwn]}>
            {String(reaction.count)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    columnGap: spacing.xxs,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.optical,
  },
  chipOwn: {
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.textDim,
  },
  count: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  countOwn: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  emoji: {
    ...typeScale.label,
  },
  row: {
    columnGap: spacing.xxs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xxs,
  },
});
