import type { AgentAvatarBadge } from "../../../ui/AgentAvatar";
import { formatDuration } from "../../../ui/number-format";
import { isBackgroundLaunch, type TaskLineEntry } from "./backgroundLaunches";

/** How one report reads: its avatar badge and a short status phrase. */
export type ReportOutcome = {
  readonly badge: AgentAvatarBadge;
  readonly phrase: string;
};

/** The one-line summary of several reports drawn outside the bubble. */
export type ReportLineSummary = {
  readonly label: string;
  readonly phrase: string;
};

const OUTCOME: Record<TaskLineEntry["status"], ReportOutcome> = {
  completed: { badge: "done", phrase: "finished" },
  failed: { badge: "failed", phrase: "failed" },
  interim: { badge: "waiting", phrase: "reported progress" },
  interrupted: { badge: "failed", phrase: "was interrupted" },
  killed: { badge: "failed", phrase: "was stopped" },
  lost: { badge: "failed", phrase: "lost on restart" },
  running: { badge: "running", phrase: "running" },
  stopped: { badge: "failed", phrase: "was stopped" },
  unknown: { badge: "waiting", phrase: "reported" },
};

/**
 * A background command whose end the Companion could not tell (another
 * provider, or an older Companion that names only the task) reads as ended,
 * neutrally: a muted dot and no claim of how it ended.
 */
const UNKNOWN_LAUNCH: ReportOutcome = { badge: "waiting", phrase: "ended" };

export function reportOutcome(report: TaskLineEntry): ReportOutcome {
  return isBackgroundLaunch(report) && report.status === "unknown"
    ? UNKNOWN_LAUNCH
    : OUTCOME[report.status];
}

/** The name shown for a report; a lost command has no useful name of its own. */
export function reportName(report: TaskLineEntry): string {
  return report.status === "lost" ? "Background command" : report.name;
}

/**
 * One reason line for any number of reports: a single report names its task;
 * several read as a count. The phrase is for assistive technology; the
 * avatars' dots show the status.
 */
export function reportLineSummary(reports: readonly TaskLineEntry[]): ReportLineSummary {
  const [first] = reports;
  if (reports.length === 1 && first !== undefined) {
    return { label: reportName(first), phrase: reportOutcome(first).phrase };
  }
  const badges = new Set(reports.map((report) => reportOutcome(report).badge));
  const agents = reports.every((report) => report.kind === "agent");
  const label = `${String(reports.length)} ${agents ? "agents" : "background tasks"}`;
  if (badges.has("failed")) {
    return { label, phrase: "some failed" };
  }
  if (badges.has("waiting")) {
    return { label, phrase: "reported" };
  }
  return { label, phrase: "finished" };
}

/**
 * One row's detail line: delivery, duration and the work it did. The dot
 * shows the outcome; the phrase stands in only when nothing else is known.
 */
export function reportDetails(report: TaskLineEntry, nowMs: number): string {
  if (isBackgroundLaunch(report)) {
    return launchDetail(report, nowMs) ?? reportOutcome(report).phrase;
  }
  const parts: string[] = [];
  if (report.delivery === "midTurn") {
    parts.push("during the answer");
  }
  if (report.durationMs !== null) {
    parts.push(formatDuration(report.durationMs));
  }
  if (report.toolUses !== null) {
    parts.push(`${String(report.toolUses)} ${report.toolUses === 1 ? "action" : "actions"}`);
  }
  return parts.length === 0 ? reportOutcome(report).phrase : parts.join(" · ");
}

/**
 * A background command's state and time on its pill: "running · 3m" while it
 * runs (from its start), its total run once it ended, "ended" when the
 * Companion could not tell how it ended.
 */
export function launchDetail(report: TaskLineEntry, nowMs: number): string | null {
  if (!isBackgroundLaunch(report)) {
    return null;
  }
  const { launch } = report;
  if (launch.status === "running") {
    return runningDetail(launch.startedAt, nowMs);
  }
  return launch.status === "unknown"
    ? UNKNOWN_LAUNCH.phrase
    : endedDetail(launch.status, report.durationMs);
}

const MS_PER_SECOND = 1000;

/** A running command's time since its start, when known. */
function runningDetail(startedAt: number | null, nowMs: number): string {
  return startedAt === null
    ? "running"
    : `running · ${formatDuration(Math.max(0, nowMs - startedAt * MS_PER_SECOND))}`;
}

/** An ended command's run: the time alone once completed, else its end and time. */
function endedDetail(
  status: "completed" | "failed" | "stopped",
  durationMs: number | null,
): string {
  const duration = durationMs === null ? null : formatDuration(durationMs);
  if (status === "completed") {
    return duration ?? "completed";
  }
  return duration === null ? status : `${status} · ${duration}`;
}
