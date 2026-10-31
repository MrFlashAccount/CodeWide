import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet, type Text as NativeText } from "react-native";

import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import {
  colors,
  controlHitSlop,
  controlSize,
  iconSize,
  radii,
  spacing,
  typeScale,
} from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { scenarioActionHint } from "./scenarioRuns";
import { useScenarioView } from "./ScenarioViewsContext";

const DISABLED_OPACITY = 0.5;
const PRESSED_OPACITY = 0.72;

/**
 * An agent scenario action shown as a robot icon, such as a failed check's Fix in agent.
 * Idle, the icon alone carries the action and `accessibilityLabel` names it. While the
 * tap is pending or its run is queued or running, the live label (`Fixing CI…`) shows
 * beside the icon and shimmers, so progress stays visible without a spinner; a finished
 * run keeps its `CI fix done · 5m ago` label. The tap behaves as in `CatalogActionButton`.
 */
export function AgentIconActionButton({
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
  const labelled = busy || scenario.kind === "done";
  return (
    <Pressable
      accessibilityHint={scenarioActionHint(action, scenario)}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      hitSlop={controlHitSlop.compact}
      onPress={() => {
        onPress(action);
      }}
      style={({ pressed }) => [
        styles.base,
        action.availability.state === "disabled" && styles.disabled,
        pressed && styles.pressed,
      ]}
      testID={`catalog-action-${action.actionId}`}
    >
      <Ionicons color={colors.text} name="sparkles-outline" size={iconSize.action} />
      {labelled ? (
        <Text numberOfLines={1} ref={text} style={styles.label}>
          {action.label}
        </Text>
      ) : null}
      <TextShimmer shimmering={busy && labelled} target={text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    backgroundColor: colors.menuHighlight,
    borderRadius: radii.medium,
    columnGap: spacing.xs,
    flexDirection: "row",
    flexShrink: 0,
    justifyContent: "center",
    minHeight: controlSize.compact,
    minWidth: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  label: {
    ...typeScale.label,
    color: colors.text,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
});
