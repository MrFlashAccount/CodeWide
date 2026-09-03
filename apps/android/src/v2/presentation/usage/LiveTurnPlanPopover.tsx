import { Pressable } from "react-native";

import { LiveTurnPlanTrigger } from "./LiveTurnPlanTrigger";
import type { LiveTurnPlanViewModel } from "./usageTypes";

interface LiveTurnPlanPopoverProps {
  plan: LiveTurnPlanViewModel;
}

export function LiveTurnPlanPopover(props: LiveTurnPlanPopoverProps): React.JSX.Element {
  const { plan } = props;
  return (
    <Pressable
      accessibilityHint="Shows the current plan on Android"
      accessibilityLabel={planAccessibilityLabel(plan)}
      accessibilityRole="button"
      testID="live-plan-chip"
    >
      <LiveTurnPlanTrigger expanded={false} plan={plan} />
    </Pressable>
  );
}

function planAccessibilityLabel(plan: LiveTurnPlanViewModel): string {
  return `Plan, ${String(plan.completedSteps)}/${String(plan.steps.length)} complete, ${plan.currentStep.text}`;
}
