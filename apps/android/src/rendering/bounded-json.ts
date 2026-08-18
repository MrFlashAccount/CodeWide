const TRUNCATED = "… [truncated]";

export function boundedJsonStringify(value: unknown, maxChars = 96_000): string {
  const budget = { chars: Math.max(128, maxChars), nodes: 2_000 };
  const seen = new WeakSet<object>();
  const normalized = boundedValue(value, budget, seen, 0);
  const serialized = JSON.stringify(normalized, null, 2) ?? String(normalized ?? "null");
  return serialized.length <= maxChars ? serialized : `${serialized.slice(0, Math.max(0, maxChars - TRUNCATED.length))}${TRUNCATED}`;
}

function boundedValue(
  value: unknown,
  budget: { chars: number; nodes: number },
  seen: WeakSet<object>,
  depth: number,
): unknown {
  if (budget.nodes <= 0 || budget.chars <= 0) return TRUNCATED;
  budget.nodes -= 1;
  if (typeof value === "string") {
    const take = Math.max(0, Math.min(value.length, budget.chars));
    budget.chars -= take;
    return take === value.length ? value : `${value.slice(0, Math.max(0, take - TRUNCATED.length))}${TRUNCATED}`;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return null;
  if (typeof value !== "object") return String(value);
  if (depth >= 12) return "[max depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length && budget.nodes > 0 && budget.chars > 0; index += 1) {
      result.push(boundedValue(value[index], budget, seen, depth + 1));
    }
    if (result.length < value.length) result.push(TRUNCATED);
    return result;
  }
  const result: Record<string, unknown> = {};
  const entries = Object.entries(value);
  for (let index = 0; index < entries.length && budget.nodes > 0 && budget.chars > 0; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const [key, child] = entry;
    budget.chars -= Math.min(key.length, budget.chars);
    result[key] = boundedValue(child, budget, seen, depth + 1);
  }
  if (Object.keys(result).length < entries.length) result.__truncated__ = true;
  return result;
}
