import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface AsyncActionFeedbackViewProps {
  error: string | null;
  onRetry?: () => void;
  pending: boolean;
  pendingLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function AsyncActionFeedbackView(
  props: AsyncActionFeedbackViewProps,
): React.JSX.Element | null {
  const { error, onRetry, pending, pendingLabel, style, testID } = props;
  const retry = useEvent(() => onRetry?.());
  if (pending) {
    return (
      <View style={[styles.feedback, style]} testID={testID}>
        <ShimmerText
          {...(testID === undefined ? {} : { testID: `${testID}-pending` })}
          style={styles.pending}
          text={pendingLabel}
        />
      </View>
    );
  }
  if (error === null) return null;
  return (
    <View accessibilityLiveRegion="polite" style={[styles.feedback, style]} testID={testID}>
      <ProductText selectable style={styles.error} tone="danger">
        {error}
      </ProductText>
      {onRetry === undefined ? null : (
        <Pressable
          accessibilityLabel="Retry failed action"
          accessibilityRole="button"
          onPress={retry}
          style={styles.retry}
          testID={testID === undefined ? undefined : `${testID}-retry`}
        >
          <ProductText style={styles.retryLabel} weight="semibold">
            Retry
          </ProductText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, ...typeScale.label },
  feedback: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  pending: { color: colors.textMuted, ...typeScale.label },
  retry: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  retryLabel: { color: colors.text, ...typeScale.label },
});
