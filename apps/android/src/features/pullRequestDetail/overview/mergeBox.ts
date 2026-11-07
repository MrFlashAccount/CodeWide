import type { CheckItem, PullRequestOverview } from "../../../data/forgePullRequestContract";
import { formatDuration } from "../../../ui/number-format";

/** Semantic tone of a merge-box row; its icon always carries the same meaning. */
export type MergeBoxTone = "danger" | "neutral" | "success" | "warning";

/** One status row of the merge box: what is true, then why or what follows. */
export type MergeBoxRow = {
  readonly detail: string;
  readonly title: string;
  readonly tone: MergeBoxTone;
};

/**
 * The merge box of an open or draft PR: checks (absent when the forge runs
 * none), the merge state, and whether merge is offered. A merged or closed PR
 * has nothing left to decide and shows no box.
 */
export type MergeBox =
  | { readonly kind: "settled" }
  | {
      readonly checks: MergeBoxRow | null;
      readonly kind: "open";
      readonly merge: MergeBoxRow;
      readonly mergeable: boolean;
    };

const MILLISECONDS_PER_SECOND = 1000;

function plural(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function checksRow(checks: PullRequestOverview["checks"]): MergeBoxRow | null {
  if (checks.state === "unavailable") {
    return {
      detail: checks.reason,
      title: "Checks unavailable",
      tone: "neutral",
    };
  }
  if (checks.state === "none") {
    return null;
  }
  const successful = `${String(checks.passed)} successful`;
  if (checks.failing > 0) {
    const pending = checks.pending > 0 ? `, ${String(checks.pending)} pending` : "";
    return {
      detail: `${String(checks.failing)} failing${pending}, ${successful}`,
      title: "Some checks were not successful",
      tone: "danger",
    };
  }
  if (checks.pending > 0) {
    return {
      detail: `${String(checks.pending)} pending, ${successful}`,
      title: "Some checks haven't completed yet",
      tone: "warning",
    };
  }
  return {
    detail: plural(checks.passed, "successful check"),
    title: "All checks have passed",
    tone: "success",
  };
}

const MERGE_STATES: Readonly<
  Record<
    PullRequestOverview["merge"]["state"],
    {
      readonly fallback: (baseBranch: string) => string;
      readonly title: string;
      readonly tone: MergeBoxTone;
    }
  >
> = {
  blocked: {
    fallback: () => "The forge's merge requirements are not met.",
    title: "Merging is blocked",
    tone: "danger",
  },
  conflicts: {
    fallback: (baseBranch) => `Resolve the conflicts with ${baseBranch} before merging.`,
    title: "This branch has conflicts",
    tone: "warning",
  },
  ready: {
    fallback: () => "Merging can be performed automatically.",
    title: "Ready to merge",
    tone: "success",
  },
  unknown: {
    fallback: () => "The forge is still computing mergeability.",
    title: "Checking mergeability",
    tone: "neutral",
  },
};

function mergeRow(overview: PullRequestOverview): MergeBoxRow {
  const reason = overview.merge.reason;
  if (overview.state === "draft") {
    return {
      detail: "Mark it ready for review before merging.",
      title: "This pull request is still a draft",
      tone: "neutral",
    };
  }
  const state = MERGE_STATES[overview.merge.state];
  return {
    detail: reason ?? state.fallback(overview.baseBranch),
    title: state.title,
    tone: state.tone,
  };
}

/** Merge-box rows for the overview; merge is offered only on an open PR the forge reports ready. */
export function mergeBox(overview: PullRequestOverview): MergeBox {
  if (overview.state === "merged" || overview.state === "closed") {
    return { kind: "settled" };
  }
  return {
    checks: checksRow(overview.checks),
    kind: "open",
    merge: mergeRow(overview),
    mergeable: overview.state === "open" && overview.merge.state === "ready",
  };
}

const CHECK_OUTCOMES: Readonly<Record<CheckItem["state"], string>> = {
  cancelled: "Cancelled",
  failed: "Failed",
  passed: "Successful",
  pending: "In progress",
  skipped: "Skipped",
};

/** `Successful in 4m 12s`, `Failed after 9.0 s`, or the bare outcome when no duration is known. */
export function checkOutcome(check: CheckItem): string {
  const outcome = CHECK_OUTCOMES[check.state];
  if (check.durationSeconds === null || check.state === "pending" || check.state === "skipped") {
    return outcome;
  }
  const duration = formatDuration(check.durationSeconds * MILLISECONDS_PER_SECOND);
  return `${outcome} ${check.state === "passed" ? "in" : "after"} ${duration}`;
}
