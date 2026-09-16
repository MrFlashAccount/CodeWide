/** Converts a finite layout percentage into React Native's numeric percentage contract. */
export function percentageDimension(value: number): `${number}%` {
  // WHY: React Native requires the numeric template-literal type; String(value) widens it to `${string}%`.
  // oxlint-disable-next-line typescript/restrict-template-expressions
  return `${value}%`;
}
