/** A release identifies a dated inventory, independently of product versions. */
export function releaseDate(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Release date must be a valid YYYY-MM-DD UTC date");
  }
  return value;
}

export function isDatedReleaseTag(value: string): boolean {
  const match = /^release-(\d{4}-\d{2}-\d{2})\.([1-9][0-9]*)$/u.exec(value);
  if (match === null) return false;
  releaseDate(match[1] ?? "");
  return Number.isSafeInteger(Number(match[2]));
}

export function nextDatedReleaseTag(date: string, reservedTags: Iterable<string>): string {
  const prefix = `release-${releaseDate(date)}.`;
  let sequence = 0;
  for (const tag of reservedTags) {
    if (tag.startsWith(prefix) && isDatedReleaseTag(tag))
      sequence = Math.max(sequence, Number(tag.slice(prefix.length)));
  }
  if (!Number.isSafeInteger(sequence + 1)) throw new Error("Release sequence exhausted");
  return `${prefix}${sequence + 1}`;
}
