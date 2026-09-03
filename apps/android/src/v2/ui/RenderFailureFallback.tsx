import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../theme";
import { ProductText } from "../presentation/text/ProductText";
import { ShimmerText } from "../presentation/text/ShimmerText";
import type { RecoverableRenderFailure } from "./renderRecoveryPrompt";

export type RecoveryHandler = (failure: RecoverableRenderFailure) => Promise<void>;

interface RenderFailureFallbackProps {
  failure: RecoverableRenderFailure;
  onDismiss?(): void;
  onFix: RecoveryHandler | null;
  onRetry(): void;
}

export function RenderFailureFallback(props: RenderFailureFallbackProps): React.JSX.Element {
  const { failure, onDismiss, onFix, onRetry } = props;
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const fix = useEvent(() => {
    if (onFix === null || fixing) return;
    setFixing(true);
    setFixError(null);
    void onFix(failure)
      .catch((cause: unknown) => {
        setFixError(cause instanceof Error ? cause.message : "Could not create a repair chat");
      })
      .finally(() => setFixing(false));
  });
  return (
    <View
      accessibilityRole="alert"
      style={[styles.failure, failure.scope === "dialog" ? styles.dialogFailure : undefined]}
      testID={`render-error-${failure.scope}`}
    >
      <ProductText weight="semibold">
        {failure.scope === "bubble"
          ? "This message could not be rendered"
          : "This view could not be opened"}
      </ProductText>
      <ProductText numberOfLines={3} selectable tone="muted">
        {failure.error.message === "" ? "Unknown React render error" : failure.error.message}
      </ProductText>
      {fixError === null ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
          {fixError}
        </ProductText>
      )}
      <View style={styles.actions}>
        <RecoveryButton label="Retry" onPress={onRetry} />
        {onFix === null ? null : (
          <RecoveryButton
            disabled={fixing}
            label="Fix this in chat"
            onPress={fix}
            pending={fixing}
            primary
          />
        )}
        {onDismiss === undefined ? null : <RecoveryButton label="Close" onPress={onDismiss} />}
      </View>
    </View>
  );
}

interface RecoveryButtonProps {
  disabled?: boolean;
  label: string;
  onPress(): void;
  pending?: boolean;
  primary?: boolean;
}

function RecoveryButton(props: RecoveryButtonProps): React.JSX.Element {
  const { disabled = false, label, onPress, pending = false, primary = false } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary ? styles.primaryButton : styles.secondaryButton]}
    >
      {pending ? (
        <ShimmerText style={primary ? styles.primaryLabel : styles.secondaryLabel} text={label} />
      ) : (
        <ProductText
          style={primary ? styles.primaryLabel : styles.secondaryLabel}
          weight="semibold"
        >
          {label}
        </ProductText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  button: {
    alignItems: "center",
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  dialogFailure: { marginHorizontal: spacing.md, marginVertical: spacing.lg },
  error: { ...typeScale.label },
  failure: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    gap: spacing.xs,
    minWidth: 0,
    padding: spacing.md,
  },
  primaryButton: { backgroundColor: colors.primary },
  primaryLabel: { color: colors.onPrimary, ...typeScale.label },
  secondaryButton: { backgroundColor: colors.surfaceContainerHighest },
  secondaryLabel: { color: colors.text, ...typeScale.label },
});
