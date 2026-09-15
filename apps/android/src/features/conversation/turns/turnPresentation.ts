/** V1 turnPresentation owner, extracted without changing interaction or resource lifetime. */
import { formatDeviceTime } from "../../../data/device-time";
import { formatDuration } from "../../../ui/number-format";

export function formatTurnMeta(
  status: "completed" | "interrupted" | "failed" | "inProgress",
  durationMs: number | null,
  completedAt: number | null,
): string {
  const label = status === "inProgress" ? "Running" : status[0]?.toUpperCase() + status.slice(1);
  const parts = [label];
  if (durationMs !== null) parts.push(formatDuration(durationMs));
  if (completedAt !== null) parts.push(formatDeviceTime(completedAt));
  return parts.join(" · ");
}
