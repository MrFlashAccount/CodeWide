import Ionicons from "@expo/vector-icons/Ionicons";
import { createElement, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";

import { liveTurnPlanProgress, type LiveTurnPlan } from "../../rendering/live-turn-plan";
import { occurrenceKey } from "../../rendering/listKey";
import { ContentMenu } from "../../ui/ContentMenu";
import { useEvent } from "../../react/useEvent";
import { colors, controlSize, iconSize, radii, spacing, typeScale, typeWeight } from "../../theme";
import { AppText as Text } from "../../ui/Typography";
import { WaveText } from "../../ui/WaveText";

const MENU_MIN_DIMENSION = 1;
const MENU_MAX_WIDTH = 400;
const MENU_WIDTH_GUTTER = 24;
const MENU_MAX_HEIGHT = 440;
const MENU_HEIGHT_GUTTER = 96;
const TRIGGER_PRESSED_OPACITY = 0.72;
const TRIGGER_ELEVATION = 4;

type PlanStep = LiveTurnPlan["steps"][number];

export function LiveTurnPlanMenu({ plan }: { readonly plan: LiveTurnPlan }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { height, width } = useWindowDimensions();
  const progress = liveTurnPlanProgress(plan);
  const currentIsRunning = progress.current?.status === "inProgress";
  const currentLabel = progress.current?.step ?? "Plan complete";
  const progressLabel = `${String(progress.completed)}/${String(plan.steps.length)}`;
  const contentWidth = Math.max(
    MENU_MIN_DIMENSION,
    Math.min(MENU_MAX_WIDTH, width - MENU_WIDTH_GUTTER),
  );
  const contentMaxHeight = Math.max(
    MENU_MIN_DIMENSION,
    Math.min(MENU_MAX_HEIGHT, height - MENU_HEIGHT_GUTTER),
  );
  const toggleOpen = useEvent(() => {
    setOpen((current) => !current);
  });
  const trigger = createElement(LiveTurnPlanTrigger, {
    currentIsRunning,
    currentLabel,
    onPress: toggleOpen,
    open,
    progressLabel,
  });

  return (
    <ContentMenu
      align="center"
      onOpenChange={setOpen}
      open={open}
      placement="top"
      trigger={trigger}
      width={contentWidth}
    >
      <LiveTurnPlanContent
        contentMaxHeight={contentMaxHeight}
        plan={plan}
        progressLabel={progressLabel}
      />
    </ContentMenu>
  );
}

function LiveTurnPlanTrigger({
  currentIsRunning,
  currentLabel,
  onPress,
  open,
  progressLabel,
}: {
  readonly currentIsRunning: boolean;
  readonly currentLabel: string;
  readonly onPress: () => void;
  readonly open: boolean;
  readonly progressLabel: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityHint="Shows the current plan"
      accessibilityLabel={`Plan, ${progressLabel} complete, ${currentLabel}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => [styles.trigger, pressed && styles.pressed]}
      testID="live-plan-chip"
    >
      <Ionicons color={colors.textMuted} name="list-outline" size={iconSize.inline} />
      <Text style={styles.triggerTitle}>Plan</Text>
      <Text style={styles.triggerDivider}>·</Text>
      <LiveTurnPlanCurrent running={currentIsRunning} text={currentLabel} />
      <Text style={styles.triggerProgress}>{progressLabel}</Text>
      <Ionicons
        color={colors.textDim}
        name={open ? "chevron-down" : "chevron-up"}
        size={iconSize.inline}
      />
    </Pressable>
  );
}

function LiveTurnPlanCurrent({
  running,
  text,
}: {
  readonly running: boolean;
  readonly text: string;
}): React.JSX.Element {
  return running ? (
    <WaveText
      containerStyle={styles.triggerCurrentShell}
      style={styles.triggerCurrent}
      testID="live-plan-chip-current"
      text={text}
    />
  ) : (
    <Text ellipsizeMode="tail" numberOfLines={1} style={styles.triggerCurrent}>
      {text}
    </Text>
  );
}

function LiveTurnPlanContent({
  contentMaxHeight,
  plan,
  progressLabel,
}: {
  readonly contentMaxHeight: number;
  readonly plan: LiveTurnPlan;
  readonly progressLabel: string;
}): React.JSX.Element {
  return (
    <View style={StyleSheet.flatten([styles.menu, { maxHeight: contentMaxHeight }])}>
      <LiveTurnPlanScroll
        contentMaxHeight={contentMaxHeight}
        plan={plan}
        progressLabel={progressLabel}
      />
    </View>
  );
}

function LiveTurnPlanScroll({
  contentMaxHeight,
  plan,
  progressLabel,
}: {
  readonly contentMaxHeight: number;
  readonly plan: LiveTurnPlan;
  readonly progressLabel: string;
}): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      style={{ maxHeight: contentMaxHeight }}
      testID="live-plan-menu"
    >
      <LiveTurnPlanHeading progressLabel={progressLabel} />
      <LiveTurnPlanExplanation explanation={plan.explanation} />
      <LiveTurnPlanSteps steps={plan.steps} />
    </ScrollView>
  );
}

function LiveTurnPlanHeading({
  progressLabel,
}: {
  readonly progressLabel: string;
}): React.JSX.Element {
  return (
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={styles.title}>
        Current plan
      </Text>
      <Text style={styles.progress}>{progressLabel}</Text>
    </View>
  );
}

function LiveTurnPlanExplanation({
  explanation,
}: {
  readonly explanation: string | null;
}): React.JSX.Element | null {
  return explanation === null || explanation.trim() === "" ? null : (
    <Text style={styles.explanation}>{explanation}</Text>
  );
}

function LiveTurnPlanSteps({ steps }: { readonly steps: readonly PlanStep[] }): React.JSX.Element {
  const occurrences = new Map<string, number>();
  return (
    <View style={styles.steps}>
      {steps.map((step, index) => (
        <LiveTurnPlanStep index={index} key={occurrenceKey(occurrences, step.step)} step={step} />
      ))}
    </View>
  );
}

function LiveTurnPlanStep({
  index,
  step,
}: {
  readonly index: number;
  readonly step: PlanStep;
}): React.JSX.Element {
  const presentation = planStepPresentation(step);
  return (
    <View accessibilityLabel={`${presentation.label}: ${step.step}`} accessible style={styles.step}>
      <Ionicons
        color={presentation.color}
        name={presentation.icon}
        size={iconSize.inline}
        style={styles.stepIcon}
      />
      <LiveTurnPlanStepText index={index} presentation={presentation} step={step} />
    </View>
  );
}

type PlanStepPresentation = {
  readonly color: string;
  readonly completed: boolean;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly label: string;
  readonly running: boolean;
};

const PLAN_STEP_PRESENTATION: Record<PlanStep["status"], PlanStepPresentation> = {
  completed: {
    color: colors.green,
    completed: true,
    icon: "checkmark-circle",
    label: "Completed",
    running: false,
  },
  inProgress: {
    color: colors.amber,
    completed: false,
    icon: "radio-button-on",
    label: "In progress",
    running: true,
  },
  pending: {
    color: colors.textDim,
    completed: false,
    icon: "ellipse-outline",
    label: "Pending",
    running: false,
  },
};

function planStepPresentation(step: PlanStep): PlanStepPresentation {
  return PLAN_STEP_PRESENTATION[step.status];
}

function LiveTurnPlanStepText({
  index,
  presentation,
  step,
}: {
  readonly index: number;
  readonly presentation: PlanStepPresentation;
  readonly step: PlanStep;
}): React.JSX.Element {
  return presentation.running ? (
    <WaveText
      containerStyle={styles.stepTextShell}
      style={styles.stepText}
      testID={`live-plan-step-${String(index)}`}
      text={step.step}
    />
  ) : (
    <Text style={[styles.stepText, presentation.completed && styles.completedStep]}>
      {step.step}
    </Text>
  );
}

const styles = StyleSheet.create({
  completedStep: { color: colors.textMuted },
  content: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
  explanation: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
    minHeight: typeScale.title.lineHeight,
  },
  menu: {
    borderRadius: radii.large,
    overflow: "hidden",
    padding: 0,
  },
  pressed: { opacity: TRIGGER_PRESSED_OPACITY },
  progress: {
    color: colors.textMuted,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  step: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  stepIcon: {
    flexShrink: 0,
    marginTop: spacing.optical,
  },
  steps: { gap: spacing.xs },
  stepText: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
  },
  stepTextShell: {
    alignSelf: "flex-start",
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: colors.text,
    flex: 1,
    ...typeScale.title,
  },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: 1,
    elevation: TRIGGER_ELEVATION,
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.xxs,
    maxWidth: "92%",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.inputInset,
  },
  triggerCurrent: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.label,
  },
  triggerCurrentShell: {
    alignSelf: "center",
    flex: 1,
    minWidth: 0,
  },
  triggerDivider: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.label,
  },
  triggerProgress: {
    color: colors.textDim,
    flexShrink: 0,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  triggerTitle: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
});
