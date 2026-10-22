import { StyleSheet, View } from "react-native";

import type { GuideStop } from "../../../data/reviewGuideContract";
import { colors, radii, spacing, typeScale, typeTracking } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { stopNarration } from "./guideWalk";

/**
 * The stop's narration, labelled with the thread that wrote it (N-08). Guide
 * text is untrusted agent output and renders as plain text.
 */
export function GuideNarration({
  authorTitle,
  changed,
  stop,
}: {
  readonly authorTitle: string;
  readonly changed: boolean;
  readonly stop: GuideStop;
}): React.JSX.Element {
  const narration = stopNarration(stop);
  return (
    <View style={styles.card} testID="review-guide-narration">
      <Text numberOfLines={1} style={styles.label}>
        {`GUIDE · WRITTEN BY ${authorTitle.toUpperCase()}`}
      </Text>
      <Text style={styles.title}>{stop.title}</Text>
      {narration === null ? null : (
        <Text selectable style={styles.body}>
          {narration}
        </Text>
      )}
      {changed ? (
        <Text style={styles.changed}>! These hunks changed after the guide was written.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    ...typeScale.body,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    marginHorizontal: spacing.md,
    padding: spacing.sm,
  },
  changed: {
    ...typeScale.label,
    color: colors.warning,
  },
  label: {
    ...typeScale.caption,
    color: colors.textDim,
    letterSpacing: typeTracking.caps,
  },
  title: {
    ...typeScale.body,
    color: colors.textMuted,
  },
});
