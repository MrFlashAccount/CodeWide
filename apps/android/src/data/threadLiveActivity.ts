import { batch, observable } from "@legendapp/state";
import type { LiveActivity } from "@codewide/sync-client";

import type { ServerRowsChange } from "./thread-summary-database-contract";
import { threadSummaryKey } from "./thread-summary-projection";

/**
 * What each running thread's agent is doing now, keyed by
 * `threadSummaryKey(connectionId, threadId)`. Process-lifetime and never
 * persisted: every Companion list row carries `codewideList.liveActivity`, so
 * the stream and the next page re-read reconstruct it.
 */
export const threadLiveActivity$ = observable<Record<string, LiveActivity>>({});

/** Activities are flat records of primitives; equal ones keep running rows from re-rendering. */
function sameActivity(left: LiveActivity | undefined, right: LiveActivity): boolean {
  if (left === undefined) {
    return false;
  }
  const leftFields: Readonly<Record<string, unknown>> = left;
  const rightFields: Readonly<Record<string, unknown>> = right;
  const keys = Object.keys(rightFields);
  return (
    keys.length === Object.keys(leftFields).length &&
    keys.every((key) => leftFields[key] === rightFields[key])
  );
}

function setRowActivity(key: string, activity: LiveActivity | null): void {
  const activity$ = threadLiveActivity$[key];
  if (activity === null) {
    activity$?.delete();
  } else if (!sameActivity(activity$?.peek(), activity)) {
    activity$?.set(activity);
  }
}

/**
 * Publishes the activity of server rows the summary database admitted, after
 * their commit, so the label never outruns the row's own running state.
 */
export function applyServerRowLiveActivity(connectionId: string, change: ServerRowsChange): void {
  batch(() => {
    if (change.kind === "replace") {
      clearConnectionActivityExcept(connectionId, change.retainedThreadIds);
    } else {
      for (const threadId of change.removedThreadIds) {
        threadLiveActivity$[threadSummaryKey(connectionId, threadId)]?.delete();
      }
    }
    for (const row of change.rows) {
      setRowActivity(threadSummaryKey(connectionId, row.threadId), row.meta.liveActivity);
    }
  });
}

/** Forgets a connection's activity except threads whose newer pushes a snapshot kept. */
function clearConnectionActivityExcept(connectionId: string, retained: ReadonlySet<string>): void {
  const prefix = threadSummaryKey(connectionId, "");
  for (const key of Object.keys(threadLiveActivity$.peek())) {
    if (key.startsWith(prefix) && !retained.has(key.slice(prefix.length))) {
      threadLiveActivity$[key]?.delete();
    }
  }
}

/** Forgets one connection's activity; its next rows start from none. */
export function clearConnectionLiveActivity(connectionId: string): void {
  const prefix = threadSummaryKey(connectionId, "");
  batch(() => {
    for (const key of Object.keys(threadLiveActivity$.peek())) {
      if (key.startsWith(prefix)) {
        threadLiveActivity$[key]?.delete();
      }
    }
  });
}
