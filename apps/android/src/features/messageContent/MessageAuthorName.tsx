import { StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import type { MessageAuthor } from "./messageContent";

const MARKER_LABELS = { ai: "AI", bot: "Bot" } as const;

/**
 * The author's login in header weight with the message's age (`dana · 2d`)
 * on one line, and for an automation account or AI reviewer an outlined
 * `Bot` / `AI` badge under it. The badge is spoken with the login.
 */
export function MessageAuthorName({
  age,
  author,
}: {
  /** `2d`, `2d · edited`; `null` shows the login alone. */
  readonly age: string | null;
  readonly author: MessageAuthor;
}): React.JSX.Element {
  const marker = author.marker === null ? null : MARKER_LABELS[author.marker];
  return (
    <View style={styles.column}>
      <View style={styles.line}>
        <Text
          accessibilityLabel={marker === null ? author.login : `${author.login}, ${marker}`}
          ellipsizeMode="tail"
          numberOfLines={1}
          style={styles.login}
        >
          {author.login}
        </Text>
        {age === null ? null : (
          <Text numberOfLines={1} style={styles.age}>
            {`· ${age}`}
          </Text>
        )}
      </View>
      {marker === null ? null : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.badge}
        >
          <Text numberOfLines={1} style={styles.badgeLabel}>
            {marker}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  age: {
    ...typeScale.label,
    color: colors.textDim,
    flexShrink: 0,
  },
  // One outlined role badge for every automation kind, as GitHub Mobile marks roles.
  badge: {
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.xs,
  },
  badgeLabel: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  column: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  line: {
    alignItems: "baseline",
    columnGap: spacing.xxs,
    flexDirection: "row",
    minWidth: 0,
  },
  login: {
    ...typeScale.body,
    color: colors.text,
    flexShrink: 1,
    fontWeight: typeWeight.semibold,
    minWidth: 0,
  },
});
