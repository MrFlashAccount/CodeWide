import { createContext, useContext, type RefObject } from "react";
import type { TokenCostEstimate } from "../../turn-cost";

/** Bounds measured in window coordinates at the opening tap. */
export type CostMenuAnchor = {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
};
/** A mounted trigger owns its estimate and measurement callback. */
export type CostMenuRequest = {
  readonly getEstimate: () => TokenCostEstimate;
  readonly measure: (receive: (anchor: CostMenuAnchor) => void) => void;
  readonly owner: symbol;
};
/** Shared popup lifecycle, independent of each trigger's render state. */
export type CostMenuController = {
  readonly remove: (owner: symbol) => void;
  readonly toggle: (request: CostMenuRequest) => void;
  readonly update: (owner: symbol, estimate: TokenCostEstimate) => void;
};
/** Stable reference prevents popup state from propagating through all rows. */
export const CostMenuContext = createContext<RefObject<CostMenuController | null> | null>(null);

/** Requires the conversation-scoped cost popup owner. */
export function useCostBreakdownMenuController(): RefObject<CostMenuController | null> {
  const controller = useContext(CostMenuContext);
  if (controller === null) {
    throw new Error("Cost actions require CostBreakdownMenuProvider");
  }
  return controller;
}
