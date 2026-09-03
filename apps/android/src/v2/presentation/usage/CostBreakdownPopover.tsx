import { Pressable } from "react-native";

import { ProductText } from "../text/ProductText";
import { formatUsageCost } from "./usageFormat";
import type { UsageBreakdownViewModel } from "./usageTypes";

interface CostBreakdownPopoverProps {
  breakdown: UsageBreakdownViewModel;
}

export function CostBreakdownPopover(props: CostBreakdownPopoverProps): React.JSX.Element {
  const { breakdown } = props;
  const cost = formatUsageCost(breakdown.turn.costUsd);
  return (
    <Pressable
      accessibilityHint="Shows the token usage breakdown on Android"
      accessibilityLabel={`Estimated API-equivalent cost ${cost}`}
      accessibilityRole="button"
    >
      <ProductText tone="muted">{cost}</ProductText>
    </Pressable>
  );
}
