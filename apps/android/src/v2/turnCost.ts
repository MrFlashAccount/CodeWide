/** Presentation-only formatting. Usage attribution and pricing belong to the companion. */
export function formatEstimatedTurnCost(cost: number): string {
  if (!Number.isFinite(cost)) return "—";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
