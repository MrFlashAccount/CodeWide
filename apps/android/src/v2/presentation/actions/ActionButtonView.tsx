import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface ActionButtonViewProps {
  disabled: boolean;
  error?: string;
  label: string;
  onPress(): void;
  pending: boolean;
}

export function ActionButtonView(props: ActionButtonViewProps): React.JSX.Element {
  const { disabled, error, label, onPress, pending } = props;
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ busy: pending, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={disabled ? disabledButtonStyle : enabledButtonStyle}
      >
        {pending ? (
          <ShimmerText style={styles.label} text={label} />
        ) : (
          <ProductText style={styles.label} weight="semibold">
            {label}
          </ProductText>
        )}
      </Pressable>
      {error === undefined ? null : (
        <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
          {error}
        </ProductText>
      )}
    </View>
  );
}

function disabledButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.button, styles.disabled, pressed && styles.pressed];
}

function enabledButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.button, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: 96,
    paddingHorizontal: spacing.md,
  },
  disabled: { opacity: 0.45 },
  error: { ...typeScale.label, marginTop: spacing.xxs },
  label: { color: colors.onPrimary, ...typeScale.body },
  pressed: { backgroundColor: colors.primaryPressed },
  root: { alignSelf: "flex-start" },
});
