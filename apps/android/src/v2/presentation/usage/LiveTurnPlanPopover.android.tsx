import { Popover } from "heroui-native/popover";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";

import { useEvent } from "../../../react/useEvent";
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
  return (
    <Popover isOpen={open} onOpenChange={changeOpen} presentation="popover">
      <Popover.Trigger asChild>
        <Pressable
          accessibilityHint="Shows the current plan"
          accessibilityLabel={planAccessibilityLabel(plan)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID="live-plan-chip"
        >
          <LiveTurnPlanTrigger expanded={open} plan={plan} />
        </Pressable>
      </Popover.Trigger>
      <Popover.Portal>
        <PresentationIconProvider renderIcon={portalIconRenderer}>
          <Popover.Overlay className="bg-backdrop" />
          <Popover.Content
            align="center"
            className="border border-border"
            offset={spacing.xs}
            placement="top"
            presentation="popover"
            style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}
            width={contentWidth}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: contentMaxHeight }}
            >
              <LiveTurnPlanContent plan={plan} />
            </ScrollView>
            <Popover.Arrow />
          </Popover.Content>
        </PresentationIconProvider>
      </Popover.Portal>
    </Popover>
  );
}

function planAccessibilityLabel(plan: LiveTurnPlanViewModel): string {
  return `Plan, ${String(plan.completedSteps)}/${String(plan.steps.length)} complete, ${plan.currentStep.text}`;
}

const styles = StyleSheet.create({
  popover: { borderRadius: radii.large, overflow: "hidden", padding: 0 },
});
