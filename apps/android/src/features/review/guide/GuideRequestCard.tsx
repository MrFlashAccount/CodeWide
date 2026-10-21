import { useRef } from "react";
import { StyleSheet, View, type Text as NativeText } from "react-native";

import type { GuideState } from "../../../data/reviewGuideContract";
import { AppButton } from "../../../presentation/controls/AppButton";
import { colors, radii, spacing, typeScale } from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";

/**
 * Guide state without a walk to show: request one, a request in flight
 * (its text shimmers in place), or the last rejected guide with Ask again.
 * A rejected guide never replaces the previous one.
 */
export function GuideRequestCard({
  authorLabel,
  disabled,
  onRequest,
  state,
}: {
  /** Who will write it: a thread title or "a new read-only thread". */
  readonly authorLabel: string;
  readonly disabled: boolean;
  readonly onRequest: () => void;
  readonly state: GuideState;
}): React.JSX.Element {
  const pendingText = useRef<NativeText>(null);
  if (state.pending !== null) {
    return (
      <View style={styles.card} testID="review-guide-pending">
        <Text ref={pendingText} style={styles.body}>{`Guide requested from ${authorLabel}`}</Text>
        <TextShimmer shimmering target={pendingText} />
      </View>
    );
  }
  return (
    <View
      style={[styles.card, state.lastError !== null && styles.error]}
      testID="review-guide-request"
    >
      {state.lastError === null ? (
        <Text
          style={styles.body}
        >{`No guide yet. ${authorLabel} can write one over these changes.`}</Text>
      ) : (
        <>
          <Text style={styles.title}>✕ New guide was rejected</Text>
          <Text style={styles.body}>{state.lastError.reason}</Text>
          {state.guide === null ? null : (
            <Text style={styles.meta}>The previous guide is kept.</Text>
          )}
        </>
      )}
      <AppButton isDisabled={disabled} onPress={onRequest} size="sm" variant="secondary">
        {state.lastError === null ? "Request guide" : "Ask again"}
      </AppButton>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    ...typeScale.body,
    color: colors.text,
  },
  card: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    padding: spacing.sm,
  },
  error: {
    backgroundColor: colors.errorContainer,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
  },
});
