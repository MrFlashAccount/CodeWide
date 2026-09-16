import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { AppPopover } from "../../../presentation/overlay/AppPopover";
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
  const toggleOpen = (): void => {
    changeOpen(!open);
  };
  return (
    <AppPopover
      align="end"
      onOpenChange={changeOpen}
      open={open}
      placement="top"
      trigger={
        <Pressable
          accessibilityHint="Shows the token usage breakdown"
          accessibilityLabel={`Estimated API-equivalent cost ${cost}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={toggleOpen}
          testID="turn-cost-trigger"
        >
          <ProductText style={styles.trigger} tone="muted">
            {cost}
          </ProductText>
        </Pressable>
      }
      width={contentWidth}
    >
      <PresentationIconProvider renderIcon={portalIconRenderer}>
        <View style={StyleSheet.flatten([styles.popover, { maxHeight: contentMaxHeight }])}>
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: contentMaxHeight }}>
            <CostBreakdownContent breakdown={breakdown} />
          </ScrollView>
        </View>
      </PresentationIconProvider>
    </AppPopover>
  );
}

const styles = StyleSheet.create({
  popover: { borderRadius: radii.large, overflow: "hidden", padding: 0 },
  trigger: { ...typeScale.caption },
});
