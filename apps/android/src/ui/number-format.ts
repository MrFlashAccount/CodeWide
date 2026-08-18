export const compactNumberFormat = {
  notation: "compact",
  maximumFractionDigits: 1,
} satisfies Intl.NumberFormatOptions;

export const integerNumberFormat = {
  maximumFractionDigits: 0,
} satisfies Intl.NumberFormatOptions;

export function usdNumberFormat(value: number): Intl.NumberFormatOptions {
  const fractionDigits = Math.abs(value) < 0.01 ? 4 : Math.abs(value) < 1 ? 3 : 2;
  return {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  };
}

export function formatNumber(value: number, format?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(undefined, format).format(Number.isFinite(value) ? value : 0);
}
