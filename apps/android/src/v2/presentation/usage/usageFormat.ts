const INTEGER_FORMAT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function formatUsageTokens(tokens: number): string {
  return `◇${INTEGER_FORMAT.format(tokens)}`;
}

export function formatUsageCost(costUsd: number | null): string {
  if (costUsd === null) return "Unavailable";
  const maximumFractionDigits = costUsd >= 0.01 ? 3 : 4;
  return `≈$${costUsd.toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  })}`;
}
