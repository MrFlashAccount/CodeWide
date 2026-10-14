import type { TaskNotificationReport } from "../../../rendering/taskNotifications";
import type { AgentAvatarBadge } from "../../../ui/AgentAvatar";
import { formatDuration } from "../../../ui/number-format";

/** How one report reads: its avatar badge and a short status phrase. */
export type ReportOutcome = {
  readonly badge: AgentAvatarBadge;
  readonly phrase: string;
};

/** The one-line summary of several reports drawn outside the bubble. */
export type ReportLineSummary = {
  readonly badge: AgentAvatarBadge;
  readonly label: string;
  readonly phrase: string;
};

const OUTCOME: Record<TaskNotificationReport["status"], ReportOutcome> = {
  completed: { badge: "done", phrase: "finished" },
  failed: { badge: "failed", phrase: "failed" },
  interim: { badge: "waiting", phrase: "reported progress" },
  killed: { badge: "failed", phrase: "was stopped" },
  lost: { badge: "failed", phrase: "lost on restart" },
  stopped: { badge: "failed", phrase: "was stopped" },
  unknown: { badge: "waiting", phrase: "reported" },
};

export function reportOutcome(report: TaskNotificationReport): ReportOutcome {
  return OUTCOME[report.status];
}

/** The name shown for a report; a lost command has no useful name of its own. */
export function reportName(report: TaskNotificationReport): string {
  return report.status === "lost" ? "Background command" : report.name;
}

/**
 * One reason line for any number of reports: a single report names its task;
 * several read as a count, with a failure taking precedence over progress.
 */
export function reportLineSummary(reports: readonly TaskNotificationReport[]): ReportLineSummary {
  const [first] = reports;
  if (reports.length === 1 && first !== undefined) {
    const outcome = reportOutcome(first);
    return { badge: outcome.badge, label: reportName(first), phrase: outcome.phrase };
  }
  const badges = new Set(reports.map((report) => reportOutcome(report).badge));
  const agents = reports.every((report) => report.kind === "agent");
  const label = `${String(reports.length)} ${agents ? "agents" : "background tasks"}`;
  if (badges.has("failed")) {
    return { badge: "failed", label, phrase: "some failed" };
  }
  if (badges.has("waiting")) {
    return { badge: "waiting", label, phrase: "reported" };
  }
  return { badge: "done", label, phrase: "finished" };
}

/** One row's detail line: outcome, delivery, duration and the work it did. */
export function reportDetails(report: TaskNotificationReport): string {
  const parts = [reportOutcome(report).phrase];
  if (report.delivery === "midTurn") {
    parts.push("during the answer");
  }
  if (report.durationMs !== null) {
    parts.push(formatDuration(report.durationMs));
  }
  if (report.toolUses !== null) {
    parts.push(`${String(report.toolUses)} ${report.toolUses === 1 ? "action" : "actions"}`);
  }
  return parts.join(" · ");
}
