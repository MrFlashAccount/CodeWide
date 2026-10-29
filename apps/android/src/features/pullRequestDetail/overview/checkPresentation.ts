import type { CheckItem, CheckSummary } from "../../../data/forgePullRequestContract";
import { colors } from "../../../theme";

/** Icon and semantic color of one check's state; the check name always accompanies it. */
export const CHECK_STATE_GLYPHS = {
  cancelled: {
    color: colors.textMuted,
    icon: "remove-circle-outline",
    label: "cancelled",
  },
  failed: { color: colors.error, icon: "close", label: "failed" },
  passed: { color: colors.success, icon: "checkmark", label: "passed" },
  pending: { color: colors.warning, icon: "ellipse-outline", label: "pending" },
  skipped: { color: colors.textMuted, icon: "remove", label: "skipped" },
} as const satisfies Record<
  CheckItem["state"],
  { readonly color: string; readonly icon: string; readonly label: string }
>;

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
