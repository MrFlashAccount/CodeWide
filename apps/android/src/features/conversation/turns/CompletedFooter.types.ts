import type { TokenCostEstimate } from "../../../turn-cost";

/** Labels use the same device clock, units and pricing authority as the adaptive live footer. */
export interface CompletedFooterProps {
  readonly duration: string;
  readonly estimate: TokenCostEstimate;
  readonly input: number;
  readonly output: number;
  readonly time: string;
}
