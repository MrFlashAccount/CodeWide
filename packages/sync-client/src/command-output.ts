/** Immutable private-content segments, in command output order. */
export interface CommandOutputReference {
  readonly id: string;
  readonly byteLength: number;
  readonly contentType: string;
  readonly encoding: "utf-8";
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // WHY: runtime object validation above is the boundary from unknown JSON;
  // indexed field validation below cannot use the unindexed object type.
  return value as Record<string, unknown>;
}

function reference(value: unknown): CommandOutputReference | null {
  const data = record(value);
  if (data === null || typeof data.id !== "string" || !/^[a-f0-9]{64}$/.test(data.id)
    || typeof data.byteLength !== "number" || !Number.isSafeInteger(data.byteLength) || data.byteLength < 0
    || typeof data.contentType !== "string" || data.encoding !== "utf-8") return null;
  return { id: data.id, byteLength: data.byteLength, contentType: data.contentType, encoding: "utf-8" };
}

export function commandOutputField(value: unknown, field: string): CommandOutputReference | null {
  const metadata = record(record(value)?.codewideContent);
  return metadata?.version === 1 ? reference(record(metadata.fields)?.[field]) : null;
}

export function commandOutputReferences(value: unknown): CommandOutputReference[] {
  const base = commandOutputField(value, "/aggregatedOutput");
  const result = base === null ? [] : [base];
  const deltas = record(value)?.codewideOutputDeltas;
  if (Array.isArray(deltas)) {
    for (const delta of deltas) {
      const parsed = reference(delta);
      if (parsed !== null) result.push(parsed);
    }
  }
  return result;
}

/** The reducer owns mutation; completed item upserts replace this transient list. */
export function appendCommandOutputReference(item: unknown, params: unknown): boolean {
  const target = record(item);
  const delta = commandOutputField(params, "/delta");
  if (target === null || delta === null) return false;
  if (Array.isArray(target.codewideOutputDeltas)) target.codewideOutputDeltas.push(delta);
  else target.codewideOutputDeltas = [delta];
  return true;
}
