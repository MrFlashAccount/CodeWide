import { Ionicons } from "@expo/vector-icons";
import { useContext } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { CheckTrigger, TriggerRun } from "../../../data/forgeCheckTriggers";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing, typeScale } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { ManualTriggersContext } from "./ManualTriggersContext";

/** A failed discovery read leaves the last successful rows available in Checks. */
export function TriggerDiscoveryNotice(): React.JSX.Element | null {
  const access = useContext(ManualTriggersContext);
  if (access === null || access.error === null) {
    return null;
  }
  return (
    <View style={styles.row}>
      <Text
        accessibilityRole="alert"
        style={styles.error}
      >{`Manual actions: ${access.error}`}</Text>
      <Pressable accessibilityRole="button" onPress={access.refresh} style={styles.button}>
        <Text style={styles.label}>Retry</Text>
      </Pressable>
    </View>
  );
}

function hasUnsubmittedAction(
  offered: readonly CheckTrigger[] | undefined,
  runs: ReadonlyMap<string, TriggerRun> | undefined,
): boolean {
  return (
    offered?.some((action) => {
      const run = runs?.get(action.actionId);
      return run === undefined || run.progress === "error";
    }) ?? false
  );
}

/** The picker target is separate from the job's viewer target. Even one command opens its chooser. */
export function ManualTriggerEntry({
  check,
}: {
  readonly check: CheckItem;
}): React.JSX.Element | null {
  const access = useContext(ManualTriggersContext);
  const open = useEvent(() => {
    access?.open(check);
  });
  const runs = access?.runs.get(check.checkId);
  const hasOptions = hasUnsubmittedAction(access?.byCheck.get(check.checkId), runs);
  if (!hasOptions && (runs?.size ?? 0) === 0) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel={`${hasOptions ? "Manual actions" : "Manual action results"} for ${check.name}`}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [styles.entry, pressed && styles.pressed]}
      testID={`pull-request-checks-manual-${check.checkId}`}
    >
      <Ionicons color={colors.warning} name="play" size={iconSize.action} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    justifyContent: "center",
    minHeight: controlSize.regular,
  },
  entry: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  error: {
    ...typeScale.label,
    color: colors.error,
    flex: 1,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  pressed: { backgroundColor: colors.surfaceContainer },
  row: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
});
