import type { CheckItem, CheckSummary } from "../../../data/forgePullRequestContract";

const SECONDS_PER_MINUTE = 60;

/** A summary the forge could count; an unavailable one is shown by its badge and reason. */
type CountedChecks = Exclude<CheckSummary, { readonly state: "unavailable" }>;

/** `1 failing · 6 passed`. */
export function checksSummaryLine(summary: CountedChecks): string {
  if (summary.state === "none") {
    return "No checks";
  }
  const parts: string[] = [];
  if (summary.failing > 0) {
    parts.push(`${String(summary.failing)} failing`);
  }
  if (summary.pending > 0) {
    parts.push(`${String(summary.pending)} pending`);
  }
  parts.push(`${String(summary.passed)} passed`);
  return parts.join(" · ");
}

/** `3m 12s`, or `null` when the forge reported no duration. */
function checkDuration(seconds: number | null): string | null {
  if (seconds === null) {
    return null;
  }
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = seconds % SECONDS_PER_MINUTE;
  return minutes === 0 ? `${String(rest)}s` : `${String(minutes)}m ${String(rest)}s`;
}

const STATE_WORDS: Readonly<Record<CheckItem["state"], string>> = {
  cancelled: "Cancelled",
  failed: "Failed",
  passed: "Passed",
  pending: "Pending",
  skipped: "Skipped",
};

/** Status line of one check: its state word, with the duration for finished runs. */
export function checkStatusLine(item: CheckItem): string {
  const duration = checkDuration(item.durationSeconds);
  if (duration === null || (item.state !== "failed" && item.state !== "passed")) {
    return STATE_WORDS[item.state];
  }
  return item.state === "failed" ? `Failed after ${duration}` : `Passed in ${duration}`;
}

/** Failing first, then pending; passed and skipped are deferred behind one row. */
export function partitionChecks(items: readonly CheckItem[]): {
  readonly attention: readonly CheckItem[];
  readonly settled: readonly CheckItem[];
} {
  const failing = items.filter((item) => item.state === "failed" || item.state === "cancelled");
  const pending = items.filter((item) => item.state === "pending");
  const settled = items.filter((item) => item.state === "passed" || item.state === "skipped");
  return { attention: [...failing, ...pending], settled };
}

/**
 * Label of the collapsed passed/skipped row. The forge's summary may count more
 * passed checks than the items it listed, so the row uses the larger count and
 * never contradicts the card header.
 */
export function settledChecksLabel(items: readonly CheckItem[], summary: CheckSummary): string {
  const listedPassed = items.filter((item) => item.state === "passed").length;
  const skipped = items.length - listedPassed;
  const passed =
    summary.state === "unavailable" ? listedPassed : Math.max(summary.passed, listedPassed);
  const parts = passed === 0 ? [] : [`${String(passed)} passed`];
  if (skipped > 0) {
    parts.push(`${String(skipped)} skipped`);
  }
  return parts.join(" · ");
}
