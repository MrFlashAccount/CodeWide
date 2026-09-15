import Ionicons from "@expo/vector-icons/Ionicons";
import { Popover } from "heroui-native/popover";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { liveTurnPlanProgress, type LiveTurnPlan } from "../../rendering/live-turn-plan";
import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";

export function LiveTurnPlanPopover({ plan }: { plan: LiveTurnPlan }) {
  const [open, setOpen] = useState(false);
  const { height, width } = useWindowDimensions();
  const progress = liveTurnPlanProgress(plan);
  const currentIsRunning = progress.current?.status === "inProgress";
  const currentLabel = progress.current?.step ?? "Plan complete";
  const progressLabel = `${progress.completed}/${plan.steps.length}`;
  const contentWidth = Math.max(1, Math.min(400, width - 24));
  const contentMaxHeight = Math.max(1, Math.min(440, height - 96));

  return (
    <Popover presentation="popover" isOpen={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Plan, ${progressLabel} complete, ${currentLabel}`}
          accessibilityHint="Shows the current plan"
          accessibilityState={{ expanded: open }}
          testID="live-plan-chip"
          style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
        >
          <Ionicons name="list-outline" size={iconSize.inline} color={colors.textMuted} />
          <Text style={styles.triggerTitle}>Plan</Text>
          <Text style={styles.triggerDivider}>·</Text>
          {currentIsRunning ? (
            <WaveText
              text={currentLabel}
              testID="live-plan-chip-current"
              style={styles.triggerCurrent}
              containerStyle={styles.triggerCurrentShell}
            />
          ) : (
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.triggerCurrent}>
              {currentLabel}
            </Text>
          )}
          <Text style={styles.triggerProgress}>{progressLabel}</Text>
          <Ionicons
            name={open ? "chevron-down" : "chevron-up"}
            size={iconSize.inline}
            color={colors.textDim}
          />
        </Pressable>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Overlay className="bg-backdrop" />
        <Popover.Content
          presentation="popover"
          placement="top"
          align="center"
          offset={8}
          width={contentWidth}
          className="border border-border"
          style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            testID="live-plan-popover"
            style={{ maxHeight: contentMaxHeight }}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>
                Current plan
              </Text>
              <Text style={styles.progress}>{progressLabel}</Text>
            </View>
            {plan.explanation !== null && plan.explanation.trim() !== "" && (
              <Text style={styles.explanation}>{plan.explanation}</Text>
            )}
            <View style={styles.steps}>
              {plan.steps.map((step, index) => {
                const completed = step.status === "completed";
                const running = step.status === "inProgress";
                return (
                  <View
                    accessibilityLabel={`${completed ? "Completed" : running ? "In progress" : "Pending"}: ${step.step}`}
                    accessible
                    key={`${index}:${step.step}`}
                    style={styles.step}
                  >
                    <Ionicons
                      name={
                        completed
                          ? "checkmark-circle"
                          : running
                            ? "radio-button-on"
                            : "ellipse-outline"
                      }
                      size={iconSize.inline}
                      color={completed ? colors.green : running ? colors.amber : colors.textDim}
                      style={styles.stepIcon}
                    />
                    {running ? (
                      <WaveText
                        text={step.step}
                        testID={`live-plan-step-${index}`}
                        style={styles.stepText}
                        containerStyle={styles.stepTextShell}
                      />
                    ) : (
                      <Text style={[styles.stepText, completed && styles.completedStep]}>
                        {step.step}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </ScrollView>
          <Popover.Arrow />
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: controlSize.compact,
    maxWidth: "92%",
    flexDirection: "row",
    flexShrink: 1,
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.inputInset,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceContainerHigh,
    elevation: 4,
  },
  triggerTitle: {
    flexShrink: 0,
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  triggerDivider: { flexShrink: 0, color: colors.textDim, ...typeScale.label },
  triggerCurrentShell: { flex: 1, minWidth: 0, alignSelf: "center" },
  triggerCurrent: { flex: 1, minWidth: 0, color: colors.textMuted, ...typeScale.label },
  triggerProgress: {
    flexShrink: 0,
    color: colors.textDim,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  pressed: { opacity: 0.72 },
  popover: { padding: 0, borderRadius: radii.large, overflow: "hidden" },
  content: { gap: spacing.sm, padding: spacing.sm },
  heading: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.xs,
  },
  title: { flex: 1, color: colors.text, ...typeScale.title },
  progress: { color: colors.textMuted, ...typeScale.label, fontVariant: ["tabular-nums"] },
  explanation: { color: colors.textMuted, ...typeScale.body },
  steps: { gap: spacing.xs },
  step: { minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  stepIcon: { flexShrink: 0, marginTop: spacing.optical },
  stepTextShell: { flex: 1, minWidth: 0, alignSelf: "flex-start" },
  stepText: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.body },
  completedStep: { color: colors.textMuted },
});
