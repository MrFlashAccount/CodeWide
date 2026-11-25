import { useEffect } from "react";
import { useConstant } from "../../react/useConstant";
import { useEvent } from "../../react/useEvent";
import type { TokenCostEstimate } from "../../turn-cost";
import { useCostBreakdownMenuController, type CostMenuRequest } from "./CostBreakdownMenuContext";

/** Keeps the open menu attached to the same mounted cost trigger and its current estimate. */
export function useCostBreakdownTrigger(
  estimate: TokenCostEstimate,
): (measure: CostMenuRequest["measure"]) => void {
  const controller = useCostBreakdownMenuController();
  const owner = useConstant(() => Symbol("cost-menu-source"));
  const getEstimate = useEvent(() => estimate);
  useEffect(() => {
    controller.current?.update(owner, estimate);
  }, [controller, estimate, owner]);
  useEffect(
    () => () => {
      controller.current?.remove(owner);
    },
    [controller, owner],
  );
  return useEvent((measure: CostMenuRequest["measure"]) => {
    controller.current?.toggle({ getEstimate, measure, owner });
  });
}
