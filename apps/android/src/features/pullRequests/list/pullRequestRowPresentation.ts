/**
 * Pure presentation of one PR row: the check glyph, the meta line and at most
 * two badges plus the linked-thread count. Colors carry state only together
 * with a glyph and a spoken word.
 */
import type { CheckSummary, PullRequestRow } from "../../../data/forgePullRequestContract";

/** A row shows at most two badges plus the linked-thread count (N-06). */
const MAX_ROW_BADGES = 2;

/** Check state as a glyph kind plus the word screen readers announce. */
export type CheckGlyph = {
  readonly kind: "failing" | "neutral" | "passing" | "pending";
  readonly word: string;
};

const GLYPHS: Readonly<Record<Exclude<CheckSummary["state"], "failing">, CheckGlyph>> = {
  none: { kind: "neutral", word: "no checks" },
  passing: { kind: "passing", word: "checks passing" },
  pending: { kind: "pending", word: "checks pending" },
  unavailable: { kind: "neutral", word: "checks unavailable" },
};

/** Maps a checks summary to its row glyph. */
export function checkGlyph(checks: CheckSummary): CheckGlyph {
  return checks.state === "failing"
    ? { kind: "failing", word: `${String(checks.failing)} failing` }
    : GLYPHS[checks.state];
}

/** Last path segment of `owner/name`, the short repository label of a row. */
function repositoryLabel(repository: string): string {
  const slash = repository.lastIndexOf("/");
  return slash === -1 ? repository : repository.slice(slash + 1);
}

/** `CodeWide #91 · dana-r · you`. */
export function rowMeta(row: PullRequestRow): string {
  const parts = [`${repositoryLabel(row.repository)} #${row.number}`, row.author];
  if (row.reviewRequestedFromMe) {
    parts.push("you");
  }
  return parts.join(" · ");
}

/** At most two badges, in priority order. */
export function rowBadges(row: PullRequestRow): readonly string[] {
  const badges: string[] = [];
  if (row.localCheckout) {
    badges.push("Local");
  }
  if (row.state === "draft") {
    badges.push("Draft");
  } else if (row.state === "merged" || row.state === "closed") {
    badges.push(row.state === "merged" ? "Merged" : "Closed");
  }
  return badges.slice(0, MAX_ROW_BADGES);
}

/** Spoken summary of a row: title, meta, check word, badges and linked threads. */
export function rowAccessibilityLabel(row: PullRequestRow, glyph: CheckGlyph): string {
  const parts = [
    row.title,
    rowMeta(row),
    ...(row.attention.state === "new" ? ["new activity"] : []),
    glyph.word,
    ...rowBadges(row),
  ];
  if (row.linkedThreadCount > 0) {
    parts.push(`${String(row.linkedThreadCount)} linked threads`);
  }
  return parts.join(", ");
}
