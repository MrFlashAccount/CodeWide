import { Popover } from "heroui-native/popover";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { radii, spacing, typeScale } from "../../theme";
import { PresentationIconProvider, usePresentationIconRenderer } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { CostBreakdownContent } from "./CostBreakdownContent";
import { formatUsageCost } from "./usageFormat";
import type { UsageBreakdownViewModel } from "./usageTypes";

interface CostBreakdownPopoverProps {
  breakdown: UsageBreakdownViewModel;
}

export function CostBreakdownPopover(props: CostBreakdownPopoverProps): React.JSX.Element {
  const { breakdown } = props;
  const [open, setOpen] = useState(false);
  const portalIconRenderer = usePresentationIconRenderer();
  const { height, width } = useWindowDimensions();
  const contentWidth = Math.max(spacing.optical, Math.min(360, width - spacing.lg));
  const contentMaxHeight = Math.max(spacing.optical, height - spacing.xl * 2);
  const cost = formatUsageCost(breakdown.turn.costUsd);
  const changeOpen = useEvent((next: boolean) => setOpen(next));
  return (
    <Popover isOpen={open} onOpenChange={changeOpen} presentation="popover">
      <Popover.Trigger asChild>
        <Pressable
          accessibilityHint="Shows the token usage breakdown"
          accessibilityLabel={`Estimated API-equivalent cost ${cost}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          testID="turn-cost-trigger"
        >
          <ProductText style={styles.trigger} tone="muted">
            {cost}
          </ProductText>
        </Pressable>
      </Popover.Trigger>
      <Popover.Portal>
        <PresentationIconProvider renderIcon={portalIconRenderer}>
          <Popover.Overlay className="bg-backdrop" />
          <Popover.Content
            align="end"
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
              <CostBreakdownContent breakdown={breakdown} />
            </ScrollView>
            <Popover.Arrow />
          </Popover.Content>
        </PresentationIconProvider>
      </Popover.Portal>
    </Popover>
  );
}

const styles = StyleSheet.create({
  popover: { borderRadius: radii.large, overflow: "hidden", padding: 0 },
  trigger: { ...typeScale.caption },
});
