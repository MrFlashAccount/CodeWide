/** Calendar boundaries between adjacent displayed messages, independent of pages. */
export class TimelineDateSequence {
  #previous: Date | null = null;
  #atBeginning: boolean;

  constructor(includesBeginning: boolean) {
    this.#atBeginning = includesBeginning;
  }

  /** Consumes one displayed message; an unknown timestamp breaks known adjacency. */
  next(timestampMs: number | null): string | null {
    const current = timestampMs === null ? null : new Date(timestampMs);
    const valid = current !== null && Number.isFinite(current.getTime()) ? current : null;
    const label =
      valid !== null &&
      (this.#atBeginning || (this.#previous !== null && !sameDate(valid, this.#previous)))
        ? valid.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })
        : null;
    this.#previous = valid;
    this.#atBeginning = false;
    return label;
  }
}

/** Separate placements are required when a response crosses midnight within a turn. */
export interface TimelineTurnDateLabels {
  before: string | null;
  agent: string | null;
}

function sameDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}
