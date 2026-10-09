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

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86_400;
const DURATION_UNITS = [
  { seconds: SECONDS_PER_DAY, suffix: "d" },
  { seconds: SECONDS_PER_HOUR, suffix: "h" },
  { seconds: SECONDS_PER_MINUTE, suffix: "m" },
  { seconds: 1, suffix: "s" },
] as const;

/** Formats elapsed time with nonzero day/hour/minute/second units and subminute precision. */
export function formatDuration(milliseconds: number): string {
  if (milliseconds < MILLISECONDS_PER_SECOND) {
    return `${String(milliseconds)} ms`;
  }
  const shortSeconds = (milliseconds / MILLISECONDS_PER_SECOND).toFixed(1);
  if (Number(shortSeconds) < SECONDS_PER_MINUTE) {
    return `${shortSeconds} s`;
  }
  // Round before decomposition so seconds carry into minutes, hours and days.
  let remainingSeconds = Math.round(milliseconds / MILLISECONDS_PER_SECOND);
  const parts: string[] = [];
  for (const unit of DURATION_UNITS) {
    const count = Math.floor(remainingSeconds / unit.seconds);
    remainingSeconds %= unit.seconds;
    if (count > 0) {
      parts.push(`${String(count)}${unit.suffix}`);
    }
  }
  return parts.join(" ");
}
