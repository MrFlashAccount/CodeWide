/** Validated Companion-owned figures; no client aggregation or price inference. */
export type ActivityFootprint = {
  readonly version: 1;
  readonly basis: "approxBytesPerToken";
  readonly bytes: number;
  readonly estimatedTokens: number;
  readonly estimatedInputCostUsd: number | null;
};

export type ActivitySummary = {
  readonly count: number;
  readonly kinds: readonly string[];
  readonly outputFootprint: ActivityFootprint;
};

export type ActivityMetrics = {
  readonly version: 1;
  readonly total: ActivitySummary;
  readonly ranges: readonly { readonly firstItemId: string; readonly lastItemId: string; readonly summary: ActivitySummary }[];
  readonly commands: Readonly<Record<string, ActivityFootprint>>;
};

function record(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  // WHY: JavaScript object validation establishes string-keyed property access;
  // individual fields are validated below before entering the project contract.
  return value as Record<string, unknown>;
}
function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parseActivityFootprint(value: unknown): ActivityFootprint | null {
  const r = record(value);
  if (r === null || r.version !== 1 || r.basis !== "approxBytesPerToken" || !count(r.bytes) || !count(r.estimatedTokens)) return null;
  const cost = r.estimatedInputCostUsd;
  if (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0)) return null;
  return { version: 1, basis: "approxBytesPerToken", bytes: r.bytes, estimatedTokens: r.estimatedTokens, estimatedInputCostUsd: cost };
}

function summary(value: unknown): ActivitySummary | null {
  const r = record(value);
  if (r === null || !count(r.count) || !Array.isArray(r.kinds)) return null;
  const kinds: string[] = [];
  for (const kind of r.kinds) { if (typeof kind !== "string") return null; kinds.push(kind); }
  const outputFootprint = parseActivityFootprint(r.outputFootprint);
  return outputFootprint === null ? null : { count: r.count, kinds, outputFootprint };
}

export function parseActivityMetrics(value: unknown): ActivityMetrics | null {
  const r = record(value);
  if (r === null || r.version !== 1 || !Array.isArray(r.ranges)) return null;
  const total = summary(r.total);
  const rawCommands = record(r.commands);
  if (total === null || rawCommands === null) return null;
  const ranges: { firstItemId: string; lastItemId: string; summary: ActivitySummary }[] = [];
  for (const entry of r.ranges) {
    const range = record(entry);
    if (range === null || typeof range.firstItemId !== "string" || typeof range.lastItemId !== "string") return null;
    const stats = summary(range.summary);
    if (stats === null) return null;
    ranges.push({ firstItemId: range.firstItemId, lastItemId: range.lastItemId, summary: stats });
  }
  const commands: Record<string, ActivityFootprint> = Object.create(null);
  for (const [id, value] of Object.entries(rawCommands)) {
    const footprint = parseActivityFootprint(value);
    if (footprint === null) return null;
    commands[id] = footprint;
  }
  return { version: 1, total, ranges, commands };
}

const cache = new WeakMap<object, ActivityMetrics | null>();
/** Reads one immutable turn projection. Absent/old projections stay unknown. */
export function projectedActivityMetrics(turn: object): ActivityMetrics | null {
  const raw = record(record(record(turn)?.codewide)?.activityMetrics);
  if (raw === null) return null;
  if (cache.has(raw)) return cache.get(raw) ?? null;
  const metrics = parseActivityMetrics(raw);
  cache.set(raw, metrics);
  return metrics;
}

/** Selects an exact server range, without deriving figures from rendered items. */
export function activityRange(metrics: ActivityMetrics | null, first: unknown, last: unknown): ActivitySummary | null {
  if (typeof first !== "string" || typeof last !== "string") return null;
  return metrics?.ranges.find((range) => range.firstItemId === first && range.lastItemId === last)?.summary ?? null;
}

/** Exact range metadata survives item-only hydration on the first item. */
export function projectedItemActivityRange(first: Record<string, unknown>, lastId: unknown): ActivitySummary | null {
  if (typeof lastId !== "string" || !Array.isArray(first.codewideActivityRanges)) return null;
  for (const entry of first.codewideActivityRanges) {
    const range = record(entry);
    if (range !== null && range.firstItemId === first.id && range.lastItemId === lastId) return summary(range.summary);
  }
  return null;
}
