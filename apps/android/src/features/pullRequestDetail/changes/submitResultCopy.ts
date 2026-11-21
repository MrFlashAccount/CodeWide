/**
 * Copy of the dock's Submit outcome. Verdict labels come from the plugin; the
 * known English imperatives read as what happened ("Approved on github.com"),
 * any other label is reported as published without guessing its grammar.
 */

const PAST_TENSE: Readonly<Record<string, string>> = {
  Approve: "Approved",
  Block: "Blocked",
  Comment: "Commented",
  "Request changes": "Changes requested",
  Ship: "Shipped",
};

/** Keeps one count and its noun on the same line when the detail wraps. */
const NO_BREAK_SPACE = " ";

/** `Approved on github.com`, or `Review published on github.com · <label>`. */
export function publishedTitle(verdict: string, host: string): string {
  const done = Object.hasOwn(PAST_TENSE, verdict) ? PAST_TENSE[verdict] : undefined;
  return done === undefined ? `Review published on ${host} · ${verdict}` : `${done} on ${host}`;
}

/** `2 published · 1 to agent · 1 left`; a wrap breaks only between segments. */
export function publishedDetail(counts: {
  readonly left: number;
  readonly published: number;
  readonly toAgent: number;
}): string {
  return [
    `${String(counts.published)} published`,
    `${String(counts.toAgent)} to agent`,
    `${String(counts.left)} left`,
  ]
    .map((segment) => segment.replaceAll(" ", NO_BREAK_SPACE))
    .join(" · ");
}
