import { threadSummaryDescendants } from "./thread-summary-descendants";
import type { StoredThreadSummary } from "./thread-summary-types";
import { unknownRecord } from "./unknownRecord";

/**
 * Whether a thread's sub-agents are running, kept on its root row: list views
 * never load child rows, yet a root that is idle while its sub-agents work is
 * still in progress for the person.
 */

/** The top thread `row` belongs to, through its loaded parents. */
function rootOf(
  row: StoredThreadSummary,
  byId: ReadonlyMap<string, StoredThreadSummary>,
): StoredThreadSummary {
  let current = row;
  const visited = new Set<string>([row.remoteThreadId]);
  while (current.parentThreadId !== null) {
    const parent = byId.get(current.parentThreadId);
    if (parent === undefined || visited.has(parent.remoteThreadId)) {
      break;
    }
    visited.add(parent.remoteThreadId);
    current = parent;
  }
  return current;
}

/** `root` with `activeSubagents` matching its loaded descendants. */
export function withActiveSubagents(
  root: StoredThreadSummary,
  rows: readonly StoredThreadSummary[],
): StoredThreadSummary {
  const active = threadSummaryDescendants(rows, root.remoteThreadId).some(
    (row) => row.status.type === "active",
  );
  return (root.activeSubagents ?? false) === active ? root : { ...root, activeSubagents: active };
}

/**
 * The root rows whose `activeSubagents` changes because the child rows in
 * `changedChildren` changed status; `rows` is the connection's rows with the
 * pending changes applied.
 */
export function rootsWithChangedSubagentActivity(
  changedChildren: readonly StoredThreadSummary[],
  rows: readonly StoredThreadSummary[],
): StoredThreadSummary[] {
  const byId = new Map(rows.map((row) => [row.remoteThreadId, row]));
  const roots = new Map<string, StoredThreadSummary>();
  for (const child of changedChildren) {
    const root = rootOf(child, byId);
    if (root.parentThreadId === null && root !== child) {
      roots.set(root.remoteThreadId, root);
    }
  }
  return [...roots.values()].flatMap((root) => {
    const next = withActiveSubagents(root, rows);
    return next === root ? [] : [next];
  });
}

/** A sub-agent's state as its parent's `collabAgentToolCall` reports it. */
export type ReportedSubagentState = {
  readonly active: boolean;
  readonly threadId: string;
};

const ACTIVE_AGENT_STATES: ReadonlySet<string> = new Set(["pendingInit", "running"]);
const ENDED_AGENT_STATES: ReadonlySet<string> = new Set([
  "completed",
  "errored",
  "interrupted",
  "shutdown",
]);

/**
 * The sub-agent states an item event of a parent thread reports
 * (`item/started` or `item/completed` of a `collabAgentToolCall`, keyed by the
 * child thread id). Only a non-primary provider relies on them: its children
 * have no live thread of their own, whereas the primary provider's children
 * report their status through their own events, which a late parent item must
 * not override.
 */
export function reportedSubagentStates(payload: unknown): ReportedSubagentState[] {
  const item = unknownRecord(unknownRecord(unknownRecord(payload)?.params)?.item);
  if (item?.type !== "collabAgentToolCall") {
    return [];
  }
  const states = unknownRecord(item.agentsStates);
  if (states === null) {
    return [];
  }
  return Object.entries(states).flatMap(([threadId, state]): ReportedSubagentState[] => {
    const status = unknownRecord(state)?.status;
    if (typeof status !== "string") {
      return [];
    }
    if (ACTIVE_AGENT_STATES.has(status)) {
      return [{ active: true, threadId }];
    }
    return ENDED_AGENT_STATES.has(status) ? [{ active: false, threadId }] : [];
  });
}

/**
 * The latest reported state of each sub-agent in a batch, from the events of
 * parents that belong to a non-primary provider (`parentOf` returns the
 * parent's current row).
 */
export function reportedSubagentStatesOfBatch(
  payloads: readonly { readonly parentThreadId: string | null; readonly payload: unknown }[],
  parentOf: (threadId: string) => StoredThreadSummary | undefined,
): ReadonlyMap<string, boolean> {
  const reported = new Map<string, boolean>();
  for (const { parentThreadId, payload } of payloads) {
    const parent = parentThreadId === null ? undefined : parentOf(parentThreadId);
    if (parent?.codewideAgent?.primary !== false) {
      continue;
    }
    for (const state of reportedSubagentStates(payload)) {
      reported.set(state.threadId, state.active);
    }
  }
  return reported;
}

/** `child` with the reported status, or `null` when it already has it. */
export function withReportedStatus(
  child: StoredThreadSummary,
  active: boolean,
): StoredThreadSummary | null {
  const status: StoredThreadSummary["status"] = active
    ? { activeFlags: [], type: "active" }
    : { type: "idle" };
  return child.status.type === status.type ? null : { ...child, status };
}
