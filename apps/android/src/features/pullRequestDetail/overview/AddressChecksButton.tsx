import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, type Text as NativeText } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { useEvent } from "../../../react/useEvent";
import { scenarioActionHint } from "../actions/scenarioRuns";
import { useScenarioView } from "../actions/ScenarioViewsContext";

const DISABLED_OPACITY = 0.5;
const PRESSED_OPACITY = 0.72;

/** Opens the full check run in the PR’s review chat, keeping the action label stable while pending. */
export function AddressChecksButton({
  accessibilityLabel,
  action,
  onPress,
  pending,
}: {
  readonly accessibilityLabel: string;
  readonly action: ActionDescriptor;
  readonly onPress: (action: ActionDescriptor) => void;
  readonly pending: boolean;
}): React.JSX.Element {
  const text = useRef<NativeText>(null);
  const scenario = useScenarioView(action.actionId);
  const busy = pending || scenario.kind === "active";
  const disabled = action.availability.state === "disabled" || pending;

  const press = useEvent(() => {
    onPress(action);
  });
  return (
    <Pressable
      accessibilityHint={scenarioActionHint(action, scenario)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={press}
      style={({ pressed }) => [
        styles.base,
        action.availability.state === "disabled" && styles.disabled,
        pressed && styles.pressed,
      ]}
      testID="pull-request-checks-address"
    >
      <Ionicons color={colors.onPrimary} name="sparkles-outline" size={iconSize.action} />

      <Text numberOfLines={1} ref={text} style={styles.label}>
        {accessibilityLabel}
      </Text>

      <TextShimmer shimmering={busy} target={text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    columnGap: spacing.xs,
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  label: {
    ...typeScale.body,
    color: colors.onPrimary,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
