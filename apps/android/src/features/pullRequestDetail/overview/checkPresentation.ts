import type { CheckItem, CheckSummary } from "../../../data/forgePullRequestContract";

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
