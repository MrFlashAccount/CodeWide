const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
const DAY_MS = HOURS_PER_DAY * HOUR_MS;
const WEEK_MS = DAYS_PER_WEEK * DAY_MS;

/**
 * Compact age of an RFC 3339 timestamp for dense rows: `now`, `4m`, `1h`,
 * `2d`, `3w`. An unparsable timestamp yields an empty string, never "NaN".
 */
export function compactAge(timestamp: string, nowMs: number): string {
  const time = Date.parse(timestamp);
  if (Number.isNaN(time)) {
    return "";
  }
  const age = Math.max(0, nowMs - time);
  if (age < MINUTE_MS) {
    return "now";
  }
  if (age < HOUR_MS) {
    return `${String(Math.floor(age / MINUTE_MS))}m`;
  }
  if (age < DAY_MS) {
    return `${String(Math.floor(age / HOUR_MS))}h`;
  }
  if (age < WEEK_MS) {
    return `${String(Math.floor(age / DAY_MS))}d`;
  }
  return `${String(Math.floor(age / WEEK_MS))}w`;
}

/** Age phrase for status lines: `just now`, `12 min ago`, `1h ago`, `2d ago`. */
export function ageAgo(timestamp: string, nowMs: number): string {
  const compact = compactAge(timestamp, nowMs);
  if (compact === "") {
    return "";
  }
  if (compact === "now") {
    return "just now";
  }
  return compact.endsWith("m") ? `${compact.slice(0, -1)} min ago` : `${compact} ago`;
}
