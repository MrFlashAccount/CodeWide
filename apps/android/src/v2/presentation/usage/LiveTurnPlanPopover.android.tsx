import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { AppPopover } from "../../../presentation/overlay/AppPopover";
import { radii, spacing } from "../../theme";
import { PresentationIconProvider, usePresentationIconRenderer } from "../icons/PresentationIcon";
import { LiveTurnPlanContent } from "./LiveTurnPlanContent";
import { LiveTurnPlanTrigger } from "./LiveTurnPlanTrigger";
import type { LiveTurnPlanViewModel } from "./usageTypes";

interface LiveTurnPlanPopoverProps {
  plan: LiveTurnPlanViewModel;
}

export function LiveTurnPlanPopover(props: LiveTurnPlanPopoverProps): React.JSX.Element {
  const { plan } = props;
  const [open, setOpen] = useState(false);
  const portalIconRenderer = usePresentationIconRenderer();
  const { height, width } = useWindowDimensions();
  const contentWidth = Math.max(spacing.optical, Math.min(400, width - spacing.lg));
  const contentMaxHeight = Math.max(spacing.optical, Math.min(440, height - spacing.xl * 3));
  const changeOpen = useEvent((next: boolean) => setOpen(next));
  const toggleOpen = (): void => {
    changeOpen(!open);
  };
  return (
    <AppPopover
      align="center"
      onOpenChange={changeOpen}
      open={open}
      placement="top"
      trigger={
        <Pressable
          accessibilityHint="Shows the current plan"
          accessibilityLabel={planAccessibilityLabel(plan)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={toggleOpen}
          style={styles.triggerPressable}
          testID="live-plan-chip"
        >
          <LiveTurnPlanTrigger expanded={open} plan={plan} />
        </Pressable>
      }
      width={contentWidth}
    >
      <PresentationIconProvider renderIcon={portalIconRenderer}>
        <View style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: contentMaxHeight }}
            testID="live-plan-popover"
          >
            <LiveTurnPlanContent plan={plan} />
          </ScrollView>
        </View>
      </PresentationIconProvider>
    </AppPopover>
  );
}

function planAccessibilityLabel(plan: LiveTurnPlanViewModel): string {
  return `Plan, ${String(plan.completedSteps)}/${String(plan.steps.length)} complete, ${plan.currentStep.text}`;
}

const styles = StyleSheet.create({
  popover: { borderRadius: radii.large, overflow: "hidden", padding: 0 },
  triggerPressable: { flexShrink: 1, maxWidth: "92%" },
});
