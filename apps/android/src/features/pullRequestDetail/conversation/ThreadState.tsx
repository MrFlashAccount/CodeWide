import { StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";

import type { ConversationReviewThread } from "../../../data/forgeConversationContract";
import { colors, radii, spacing, typeScale, typeWeight } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";

type Tone = "danger" | "muted" | "success" | "warning";

/** A thread's resolution as a dot and a word, or nothing for a thread without one. */
function stateOf(
  resolution: ConversationReviewThread["resolution"],
): { readonly label: string; readonly tone: Tone } | null {
  if (resolution.kind === "conversation") {
    return resolution.resolved
      ? { label: "Resolved", tone: "success" }
      : { label: "Unresolved", tone: "warning" };
  }
  if (resolution.kind === "issue") {
    return ISSUE_STATES[resolution.state];
  }
  return null;
}

const ISSUE_STATES = {
  dropped: { label: "Dropped", tone: "muted" },
  open: { label: "Open issue", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
} as const satisfies Record<string, { readonly label: string; readonly tone: Tone }>;

/** The thread header's state: a colored dot and the word, so color is never the only signal. */
export function ThreadState({
  resolution,
}: {
  readonly resolution: ConversationReviewThread["resolution"];
}): React.JSX.Element | null {
  const state = stateOf(resolution);
  if (state === null) {
    return null;
  }
  const tone = TONES[state.tone];
  return (
    <View style={styles.row}>
      <View style={[styles.dot, tone.dot]} />
      <Text numberOfLines={1} style={[styles.label, tone.text]}>
        {state.label}
      </Text>
    </View>
  );
}

const DOT_SIZE = 6;

const styles = StyleSheet.create({
  dangerDot: { backgroundColor: colors.error },
  dangerText: { color: colors.error },
  dot: {
    borderRadius: radii.pill,
    height: DOT_SIZE,
    width: DOT_SIZE,
  },
  label: {
    ...typeScale.label,
    fontWeight: typeWeight.medium,
  },
  mutedDot: { backgroundColor: colors.textDim },
  mutedText: { color: colors.textDim },
  row: {
    alignItems: "center",
    columnGap: spacing.xxs,
    flexDirection: "row",
    flexShrink: 0,
  },
  successDot: { backgroundColor: colors.success },
  successText: { color: colors.success },
  warningDot: { backgroundColor: colors.warning },
  warningText: { color: colors.warning },
});

const TONES: Readonly<Record<Tone, { readonly dot: ViewStyle; readonly text: TextStyle }>> = {
  danger: { dot: styles.dangerDot, text: styles.dangerText },
  muted: { dot: styles.mutedDot, text: styles.mutedText },
  success: { dot: styles.successDot, text: styles.successText },
  warning: { dot: styles.warningDot, text: styles.warningText },
};
