import { useEffect, useRef, type ReactElement } from "react";
import { Pressable, StyleSheet, type View } from "react-native";

import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import { colors, typeScale } from "../../theme";
import { formatEstimatedTurnCost, type TokenCostEstimate } from "../../turn-cost";
import { AnimatedNumber, usdNumberFormat } from "../../ui/AnimatedNumber";
import { AppText as Text } from "../../ui/Typography";
import { useCostBreakdownMenuController } from "./CostBreakdownMenuContext";

export { CostBreakdownMenuProvider } from "./CostBreakdownMenuHost";

/** Lightweight trigger; detailed cost UI belongs to the shared conversation host. */
export function CostBreakdownMenu({
  animated = false,
  estimate,
}: {
  animated?: boolean;
  estimate: TokenCostEstimate;
}): ReactElement {
  const controller = useCostBreakdownMenuController();
  const owner = useConstant(() => Symbol("cost-menu-source"));
  const trigger = useRef<View>(null);
  const getEstimate = useEvent(() => estimate);
  const open = useEvent(() => {
    controller.current?.toggle({
      getEstimate,
      measure: (receive) =>
        trigger.current?.measureInWindow((...bounds) => {
          const [left, top, width, height] = bounds;
          receive({ height, left, top, width });
        }),
      owner,
    });
  });
  useEffect(() => {
    controller.current?.update(owner, estimate);
  }, [controller, estimate, owner]);
  useEffect(
    () => () => {
      controller.current?.remove(owner);
    },
    [controller, owner],
  );
  return (
    <Pressable
      accessibilityHint="Shows the token cost breakdown"
      accessibilityLabel={`Estimated API-equivalent cost ${formatEstimatedTurnCost(estimate.totalCostUsd)}`}
      accessibilityRole="button"
      collapsable={false}
      hitSlop={5}
      onPress={open}
      ref={trigger}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {animated ? (
        <AnimatedNumber
          format={usdNumberFormat(estimate.totalCostUsd)}
          prefix="≈"
          style={styles.trigger}
          value={estimate.totalCostUsd}
        />
      ) : (
        <Text numberOfLines={1} style={styles.trigger}>
          ≈{formatEstimatedTurnCost(estimate.totalCostUsd)}
        </Text>
      )}
    </Pressable>
  );
}

const PRESSED_OPACITY = 0.68;

const styles = StyleSheet.create({
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  trigger: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
