import Ionicons from "@expo/vector-icons/Ionicons";
import { Popover } from "heroui-native/popover";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { liveTurnPlanProgress, type LiveTurnPlan } from "../rendering/live-turn-plan";
import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

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
          <Ionicons name="list-outline" size={15} color={colors.textMuted} />
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
            <Text numberOfLines={1} ellipsizeMode="tail" style={styles.triggerCurrent}>{currentLabel}</Text>
          )}
          <Text style={styles.triggerProgress}>{progressLabel}</Text>
          <Ionicons name={open ? "chevron-down" : "chevron-up"} size={13} color={colors.textDim} />
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
            testID="live-plan-popover"
            style={{ maxHeight: contentMaxHeight }}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={styles.title}>Current plan</Text>
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
                      name={completed ? "checkmark-circle" : running ? "radio-button-on" : "ellipse-outline"}
                      size={17}
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
                      <Text style={[styles.stepText, completed && styles.completedStep]}>{step.step}</Text>
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
    minHeight: 34,
    maxWidth: "92%",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceContainerHigh,
    elevation: 4,
  },
  triggerTitle: { flexShrink: 0, color: colors.text, fontSize: 11, lineHeight: 15, fontWeight: "700" },
  triggerDivider: { flexShrink: 0, color: colors.textDim, fontSize: 11, lineHeight: 15 },
  triggerCurrentShell: { flex: 1, minWidth: 0, alignSelf: "center" },
  triggerCurrent: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  triggerProgress: { flexShrink: 0, color: colors.textDim, fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"] },
  pressed: { opacity: 0.72 },
  popover: { padding: 0, borderRadius: radii.large, overflow: "hidden" },
  content: { gap: spacing.sm, padding: spacing.sm },
  heading: { minHeight: 22, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.xs },
  title: { flex: 1, color: colors.text, ...typeScale.titleMedium },
  progress: { color: colors.textMuted, ...typeScale.labelMedium, fontVariant: ["tabular-nums"] },
  explanation: { color: colors.textMuted, ...typeScale.bodyMedium },
  steps: { gap: spacing.xs },
  step: { minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: spacing.xs },
  stepIcon: { flexShrink: 0, marginTop: 1 },
  stepTextShell: { flex: 1, minWidth: 0, alignSelf: "flex-start" },
  stepText: { flex: 1, minWidth: 0, color: colors.text, ...typeScale.bodyMedium },
  completedStep: { color: colors.textMuted },
});
