import { StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import type { LiveTurnPlanViewModel } from "./usageTypes";

interface LiveTurnPlanTriggerProps {
  expanded: boolean;
  plan: LiveTurnPlanViewModel;
}

export function LiveTurnPlanTrigger(props: LiveTurnPlanTriggerProps): React.JSX.Element {
  const { expanded, plan } = props;
  const progress = `${String(plan.completedSteps)}/${String(plan.steps.length)}`;
  return (
    <View style={styles.trigger}>
      <PresentationIcon color={colors.textMuted} name="list" size={typeScale.label.fontSize} />
      <ProductText style={styles.title} weight="semibold">
        Plan
      </ProductText>
      <ProductText style={styles.fixed} tone="dim">
        ·
      </ProductText>
      {plan.currentStep.state === "running" ? (
        <ShimmerText
          containerStyle={styles.currentShell}
          style={styles.current}
          testID="live-plan-chip-current"
          text={plan.currentStep.text}
        />
      ) : (
        <ProductText ellipsizeMode="tail" numberOfLines={1} style={styles.current} tone="muted">
          {plan.currentStep.text}
        </ProductText>
      )}
      <ProductText style={styles.progress} tone="dim">
        {progress}
      </ProductText>
      <PresentationIcon
        color={colors.textDim}
        name={expanded ? "chevronDown" : "chevronUp"}
        size={typeScale.label.fontSize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  current: { flex: 1, minWidth: 0, ...typeScale.label },
  currentShell: { alignSelf: "center", flex: 1, minWidth: 0 },
  fixed: { flexShrink: 0, ...typeScale.label },
  progress: { flexShrink: 0, fontVariant: ["tabular-nums"], ...typeScale.caption },
  title: { flexShrink: 0, ...typeScale.label },
  trigger: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: "92%",
    minHeight: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
});
