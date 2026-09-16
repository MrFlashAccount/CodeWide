export const compactNumberFormat = {
  maximumFractionDigits: 1,
  notation: "compact",
} satisfies Intl.NumberFormatOptions;

export const integerNumberFormat = {
  maximumFractionDigits: 0,
} satisfies Intl.NumberFormatOptions;

export function usdNumberFormat(value: number): Intl.NumberFormatOptions {
  const fractionDigits = Math.abs(value) < 0.01 ? 4 : Math.abs(value) < 1 ? 3 : 2;
  return {
    currency: "USD",
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
    style: "currency",
  };
}

export function formatNumber(value: number, format?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(undefined, format).format(Number.isFinite(value) ? value : 0);
}

/** V1 number-format owner, extracted without changing interaction or resource lifetime. */

export function compactNumber(value: number): string {
  if (Math.abs(value) < 1000) {
    return value.toLocaleString();
  }
  if (Math.abs(value) < 1_000_000) {
    return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  }
  return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${String(milliseconds)} ms`;
  }
  if (milliseconds >= 60_000) {
    const minutes = Math.floor(milliseconds / 60_000);
    const seconds = Math.round((milliseconds % 60_000) / 1000);
    return `${String(minutes)}m ${String(seconds)}s`;
  }
  return `${(milliseconds / 1000).toFixed(1)} s`;
}
