import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing, touchTarget } from "../../theme";
import { ProductText } from "../text/ProductText";

interface ActionButtonViewProps {
  disabled: boolean;
  error?: string;
  label: string;
  onPress(): void;
  pending: boolean;
}

export function ActionButtonView({
  disabled,
  error,
  label,
  onPress,
  pending,
}: ActionButtonViewProps): React.JSX.Element {
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
          <ActivityIndicator accessibilityLabel={`${label} in progress`} color={colors.onPrimary} />
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

function disabledButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.button, styles.disabled, pressed && styles.pressed];
}

function enabledButtonStyle({ pressed }: PressableStateCallbackType) {
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
  error: { fontSize: 12, lineHeight: 17, marginTop: spacing.xxs },
  label: { color: colors.onPrimary, fontSize: 13, lineHeight: 18 },
  pressed: { backgroundColor: colors.primaryPressed },
  root: { alignSelf: "flex-start" },
});
