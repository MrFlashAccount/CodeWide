import { useRef } from "react";
import { Pressable, StyleSheet, type Text as NativeText } from "react-native";

import {
  colors,
  controlHitSlop,
  controlSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";

const PRESSED_OPACITY = 0.72;

/**
 * "Address in agent" for one review thread, in the compact catalog geometry.
 * A pending start keeps its label and shimmers in place.
 */
export function AgentThreadButton({
  onPress,
  pending,
  testID,
}: {
  readonly onPress: () => void;
  readonly pending: boolean;
  readonly testID: string;
}): React.JSX.Element {
  const label = useRef<NativeText>(null);
  return (
    <Pressable
      accessibilityLabel="Address in agent"
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled: pending }}
      disabled={pending}
      hitSlop={controlHitSlop.compact}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      testID={testID}
    >
      <Text numberOfLines={1} ref={label} style={styles.label}>
        Address in agent
      </Text>
      <TextShimmer shimmering={pending} target={label} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
