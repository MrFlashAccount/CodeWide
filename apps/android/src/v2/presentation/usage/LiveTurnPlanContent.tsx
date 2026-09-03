import { StyleSheet, View } from "react-native";

import { colors, spacing, typeScale } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import type { LiveTurnPlanStepViewModel, LiveTurnPlanViewModel } from "./usageTypes";

interface LiveTurnPlanContentProps {
  plan: LiveTurnPlanViewModel;
}

interface PlanStepViewProps {
  index: number;
  step: LiveTurnPlanStepViewModel;
}

export function LiveTurnPlanContent(props: LiveTurnPlanContentProps): React.JSX.Element {
  const { plan } = props;
  return (
    <View style={styles.content} testID="live-plan-popover">
      <View style={styles.heading}>
        <ProductText accessibilityRole="header" style={styles.grow} weight="semibold">
          Current plan
        </ProductText>
        <ProductText style={styles.progress} tone="muted">
          {plan.completedSteps}/{plan.steps.length}
        </ProductText>
      </View>
      {plan.explanation === null || plan.explanation.trim() === "" ? null : (
        <ProductText tone="muted">{plan.explanation}</ProductText>
      )}
      <View style={styles.steps}>
        {plan.steps.map((step, index) => (
          <PlanStepView index={index} key={step.id} step={step} />
        ))}
      </View>
    </View>
  );
}

function PlanStepView(props: PlanStepViewProps): React.JSX.Element {
  const { index, step } = props;
  const running = step.state === "running";
  return (
    <View
      accessibilityLabel={`${stepStateLabel(step)}: ${step.text}`}
      accessible
      style={styles.step}
    >
      <PresentationIcon
        color={stepColor(step)}
        name={stepIcon(step)}
        size={typeScale.title.fontSize}
      />
      {running ? (
        <ShimmerText
          containerStyle={styles.stepTextShell}
          style={styles.stepText}
          testID={`live-plan-step-${String(index)}`}
          text={step.text}
        />
      ) : (
        <ProductText
          style={styles.stepText}
          tone={step.state === "completed" ? "muted" : "default"}
        >
          {step.text}
        </ProductText>
      )}
    </View>
  );
}

function stepColor(step: LiveTurnPlanStepViewModel): string {
  if (step.state === "completed") return colors.green;
  if (step.state === "running") return colors.amber;
  return colors.textDim;
}

function stepIcon(step: LiveTurnPlanStepViewModel): PresentationIconName {
  if (step.state === "completed") return "checkCircle";
  if (step.state === "running") return "radio";
  return "radio";
}

function stepStateLabel(step: LiveTurnPlanStepViewModel): string {
  if (step.state === "completed") return "Completed";
  if (step.state === "running") return "In progress";
  return "Pending";
}

const styles = StyleSheet.create({
  content: { gap: spacing.sm, padding: spacing.sm },
  grow: { flex: 1, minWidth: 0 },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
  },
  progress: { flexShrink: 0, fontVariant: ["tabular-nums"], ...typeScale.label },
  step: { alignItems: "flex-start", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
  stepText: { flex: 1, minWidth: 0 },
  stepTextShell: { alignSelf: "flex-start", flex: 1, minWidth: 0 },
  steps: { gap: spacing.xs },
});
