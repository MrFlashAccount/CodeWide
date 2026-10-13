/**
 * Links a session's history across its compactions.
 *
 * Claude writes a compact boundary with `parentUuid: null`: the model's
 * context restarts at the boundary, so the SDK's session read, which walks
 * the active branch from the newest message back through `parentUuid`, ends
 * there and returns nothing older. A conversation shown to a person keeps
 * what came before. The boundary names the conversation it continues: the
 * messages Claude preserved past the compaction (`compactMetadata`
 * `preservedMessages`, formerly `preservedSegment`), which the SDK itself
 * relinks behind the compact summary, and `logicalParentUuid`. The boundary
 * is linked to the message the first preserved message originally followed,
 * else to its logical parent; the SDK's own relinking of the preserved
 * messages then yields one chain: the history before the compaction, the
 * boundary, the summary, the preserved messages and everything after.
 * Pure.
 */

/** One stored transcript row, as the SDK's session store passes it. */
export interface TranscriptRow {
  readonly [field: string]: unknown;
  readonly type: string;
  readonly uuid?: string;
}

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDetachedBoundary = (row: TranscriptRow): boolean =>
  row.type === "system" &&
  row["subtype"] === "compact_boundary" &&
  (row["parentUuid"] ?? null) === null;

/** The first message Claude preserved past the compaction, if it names one. */
function preservedHead(row: TranscriptRow): string | null {
  const metadata = row["compactMetadata"];
  if (!isRecord(metadata)) {
    return null;
  }
  const preserved = metadata["preservedMessages"];
  if (isRecord(preserved) && Array.isArray(preserved["uuids"])) {
    const first = str(preserved["uuids"][0]);
    if (first !== null) {
      return first;
    }
  }
  const segment = metadata["preservedSegment"];
  return isRecord(segment) ? str(segment["headUuid"]) : null;
}

/** The message the compacted conversation ended with, before the boundary. */
function continuedFrom(
  row: TranscriptRow,
  parentOf: ReadonlyMap<string, string | null>,
): string | null {
  const head = preservedHead(row);
  if (head !== null && parentOf.has(head)) {
    return parentOf.get(head) ?? null;
  }
  return str(row["logicalParentUuid"]);
}

/**
 * `rows` with every detached compact boundary linked to the history it
 * continues, as a new array (the SDK's store contract takes a mutable one);
 * other rows are the same objects.
 */
export function linkAcrossCompactions<Row extends TranscriptRow>(rows: readonly Row[]): Row[] {
  const parentOf = new Map<string, string | null>();
  for (const row of rows) {
    if (row.uuid !== undefined) {
      parentOf.set(row.uuid, str(row["parentUuid"]));
    }
  }
  return rows.map((row) => {
    if (!isDetachedBoundary(row)) {
      return row;
    }
    const parent = continuedFrom(row, parentOf);
    return parent === null || !parentOf.has(parent) ? row : { ...row, parentUuid: parent };
  });
}
