import { Ionicons } from "@expo/vector-icons";
import { useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { useEvent } from "../../../react/useEvent";

interface AttachmentPreviewStateProps {
  message: string;
  onRetry?: () => void | Promise<void>;
  tone: "error" | "loading" | "success";
}

export function AttachmentPreviewState(props: AttachmentPreviewStateProps): React.JSX.Element {
  const { message, onRetry, tone } = props;
  const [pending, startTransition] = useTransition();
  const accessibilityState = { busy: pending, disabled: pending };
  const retry = useEvent((): void => {
    if (onRetry === undefined || pending) return;
    startTransition(async () => onRetry());
  });
  if (tone === "loading") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.center}>
        <ShimmerText text={message} />
      </View>
    );
  }
  return (
    <View accessibilityLiveRegion="polite" style={styles.feedback}>
      <Ionicons
        color={tone === "error" ? colors.red : colors.green}
        name={tone === "error" ? "alert-circle-outline" : "checkmark-circle-outline"}
        size={19}
      />
      <Text style={tone === "error" ? styles.error : styles.success}>{message}</Text>
      {onRetry === undefined ? null : (
        <Pressable
          accessibilityLabel="Retry attachment action"
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          disabled={pending}
          onPress={retry}
          style={styles.retry}
        >
          {pending ? <ShimmerText text="Retrying…" /> : <Text style={styles.retryText}>Retry</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center", padding: spacing.lg },
  error: { color: colors.red, flex: 1, ...typeScale.body },
  feedback: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  retry: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  retryText: { color: colors.text, ...typeScale.label },
  success: { color: colors.green, flex: 1, ...typeScale.body },
});
