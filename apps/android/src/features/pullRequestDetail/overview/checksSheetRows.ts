import type { CheckItem } from "../../../data/forgePullRequestContract";
import { colors } from "../../../theme";
import { formatDuration } from "../../../ui/number-format";

type SheetRow =
  | { readonly check: CheckItem; readonly kind: "job" }
  | { readonly count: number; readonly kind: "required" | "other" | "unspecified" };

const RUNNING = 0;
const FAILED = 1;
const PASSED = 2;
const PENDING = 3;
const SETTLED = 4;

const STATUS = {
  cancelled: {
    color: colors.textMuted,
    icon: "remove-circle-outline",
    label: "Cancelled",
    rank: SETTLED,
  },
  failed: { color: colors.error, icon: "close-circle-outline", label: "Failed", rank: FAILED },
  inactive: {
    color: colors.textMuted,
    icon: "remove-circle-outline",
    label: "Inactive",
    rank: SETTLED,
  },
  passed: {
    color: colors.success,
    icon: "checkmark-circle-outline",
    label: "Passed",
    rank: PASSED,
  },
  pending: { color: colors.warning, icon: "time-outline", label: "Pending", rank: PENDING },
  queued: { color: colors.warning, icon: "time-outline", label: "Queued", rank: PENDING },
  running: { color: colors.warning, icon: "time-outline", label: "Running", rank: RUNNING },
  skipped: {
    color: colors.textMuted,
    icon: "remove-circle-outline",
    label: "Skipped",
    rank: SETTLED,
  },
} as const;

/** Preserves the forge outcome when no finer activity is available. */
export function jobStatus(check: CheckItem): (typeof STATUS)[keyof typeof STATUS] {
  return STATUS[check.activity ?? check.state];
}

const MS_PER_SECOND = 1000;

/** Secondary information on a job row. */
export function checkMetadata(check: CheckItem): string {
  const details = [];
  if (check.durationSeconds !== null) {
    details.push(formatDuration(check.durationSeconds * MS_PER_SECOND));
  }
  if (check.onDemand === true) {
    details.push("On demand");
  }
  return details.join(" · ");
}

/** Ordered sections and rows for the virtualized sheet, including older providers with unknown requiredness. */
export function checksSheetRows(
  checks: readonly CheckItem[],
  query: string,
  otherExpanded: boolean,
): readonly SheetRow[] {
  const groups = matchingGroups(checks, query.trim().toLowerCase());
  const hasRequirements = checks.some((check) => typeof check.required === "boolean");
  const rows: SheetRow[] = [];
  for (const kind of ["required", "other", "unspecified"] as const) {
    const section = groups[kind];
    if (section.length === 0) {
      continue;
    }
    if (kind !== "unspecified" || hasRequirements) {
      rows.push({ count: section.length, kind });
    }
    if (kind !== "other" || otherExpanded) {
      for (const row of section) {
        rows.push(row);
      }
    }
  }
  return rows;
}

type Groups = Record<"required" | "other" | "unspecified", SheetRow[]>;

function matchingGroups(checks: readonly CheckItem[], match: string): Groups {
  const matches = checks.filter((check) => check.name.toLowerCase().includes(match));
  matches.sort((left, right) => jobStatus(left).rank - jobStatus(right).rank);
  const groups: Groups = {
    other: [],
    required: [],
    unspecified: [],
  };
  for (const check of matches) {
    const group =
      check.required === true ? "required" : check.required === false ? "other" : "unspecified";
    groups[group].push({ check, kind: "job" });
  }
  return groups;
}
