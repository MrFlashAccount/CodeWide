import { StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { MessageAuthor } from "./messageContent";

const MARKER_LABELS = { ai: "AI", bot: "bot" } as const;

/**
 * The author's login in the message header weight, followed by a quiet
 * `bot` or `AI` marker for automation accounts and AI reviewers; the marker is
 * spoken with the login.
 */
export function MessageAuthorName({
  author,
}: {
  readonly author: MessageAuthor;
}): React.JSX.Element {
  const marker = author.marker === null ? null : MARKER_LABELS[author.marker];
  return (
    <View
      accessibilityLabel={marker === null ? author.login : `${author.login}, ${marker}`}
      accessible
      style={styles.row}
    >
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.login}>
        {author.login}
      </Text>
      {marker === null ? null : (
        <View style={styles.marker}>
          <Text numberOfLines={1} style={styles.markerLabel}>
            {marker}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  login: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
    minWidth: 0,
  },
  marker: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.compact,
    flexShrink: 0,
    paddingHorizontal: spacing.xxs,
  },
  markerLabel: {
    ...typeScale.caption,
    color: colors.textMuted,
  },
  row: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
    flexShrink: 1,
    minWidth: 0,
  },
});
