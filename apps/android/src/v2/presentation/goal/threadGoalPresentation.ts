import type { V2ThreadGoalStatus } from "@codewide/sync-client/v2";

const THREAD_GOAL_STATUS_LABELS = Object.freeze({
  active: "Active",
  blocked: "Blocked",
  budgetLimited: "Budget limited",
  complete: "Complete",
  paused: "Paused",
  usageLimited: "Usage limited",
} satisfies Readonly<Record<V2ThreadGoalStatus, string>>);

export function threadGoalStatusLabel(status: V2ThreadGoalStatus): string {
  return THREAD_GOAL_STATUS_LABELS[status];
}

export function formatThreadGoalDuration(seconds: number): string {
  if (seconds < 60) return `${String(seconds)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes)}m ${String(remainder)}s`;
  return `${String(minutes)}m ${String(remainder)}s`;
}
