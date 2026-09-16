import type { StoredThreadSummary } from "./thread-summary-types";

/** Traverses a server's parent index once, independent of input order or nesting depth. */
export function threadSummaryDescendants(
  rows: readonly StoredThreadSummary[],
  rootThreadId: string,
): StoredThreadSummary[] {
  const children = new Map<string, StoredThreadSummary[]>();
  for (const row of rows) {
    const parent = row.parentThreadId;
    if (parent === null) {
      continue;
    }
    const siblings = children.get(parent);
    if (siblings === undefined) {
      children.set(parent, [row]);
    } else {
      siblings.push(row);
    }
  }
  const visited = new Set([rootThreadId]);
  const pending = [rootThreadId];
  const result: StoredThreadSummary[] = [];
  for (let index = 0; index < pending.length; index++) {
    const parent = pending[index];
    if (parent === undefined) {
      continue;
    }
    for (const row of children.get(parent) ?? []) {
      if (visited.has(row.remoteThreadId)) {
        continue;
      }
      visited.add(row.remoteThreadId);
      result.push(row);
      pending.push(row.remoteThreadId);
    }
  }
  return result;
}
