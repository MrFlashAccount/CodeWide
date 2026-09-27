import {
  globalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import type { GlobalSupervisorPendingRequestSummary } from "./globalSupervisorPendingRequest";
import type { GlobalSupervisorSpokenAttentionPolicy } from "./globalSupervisorAttention";
import { projectGlobalSupervisorSafeText } from "./globalSupervisorSafeText";
import type { StoredThreadSummary } from "./thread-summary-types";
import { GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT } from "./globalSupervisorWorkCatalog";

const ACTIVE_WORK_MAX_ITEMS = 32;
const RECENT_COMPLETION_MAX_ITEMS = 8;
const FIND_CHAT_MAX_RESULTS = 5;
const WORK_SUMMARY_MAX_CHARACTERS = 320;
const PENDING_REQUEST_MAX_PER_CHAT = 4;
const MILLISECONDS_PER_SECOND = 1000;
const STATUS_PRIORITY_WAITING = 0;
const STATUS_PRIORITY_FAILED = 1;
const STATUS_PRIORITY_RUNNING = 2;
const STATUS_PRIORITY_COMPLETED = 3;

type GlobalSupervisorActiveWorkItem = {
  readonly pendingRequests: readonly GlobalSupervisorPendingRequestSummary[];
  readonly pendingRequestsTruncated: boolean;
  readonly project: string;
  readonly spokenAttention: GlobalSupervisorSpokenAttentionPolicy;
  readonly status: "completed" | "failed" | "running" | "waitingForUser";
  readonly summary: string;
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly title: string;
  readonly updatedAt: number;
};

export type GlobalSupervisorActiveWorkSnapshot = {
  readonly items: readonly GlobalSupervisorActiveWorkItem[];
  readonly truncated: boolean;
};

type GlobalSupervisorChatMatch = {
  readonly project: string;
  readonly summary: string;
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly title: string;
};

export type GlobalSupervisorFindChatResult =
  | { readonly status: "notFound" }
  | {
      readonly candidates: readonly GlobalSupervisorChatMatch[];
      readonly status: "ambiguous";
      readonly truncated: boolean;
    }
  | { readonly chat: GlobalSupervisorChatMatch; readonly status: "found" };

type PendingByThread = ReadonlyMap<string, readonly GlobalSupervisorPendingRequestSummary[]>;

function qualifiedKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function safeText(value: string, fallback: string): string {
  const projected = projectGlobalSupervisorSafeText(value, WORK_SUMMARY_MAX_CHARACTERS);
  return projected === "" ? fallback : projected;
}

function projectName(row: StoredThreadSummary): string {
  const source = row.gitOriginUrl ?? row.cwd;
  const normalized = source.replaceAll("\\", "/").replace(/\/$/u, "");
  const leaf = normalized.slice(normalized.lastIndexOf("/") + 1).replace(/\.git$/u, "");
  return safeText(leaf, "Unknown project");
}

function title(row: StoredThreadSummary): string {
  return safeText(row.name ?? row.preview.split("\n", 1)[0] ?? "", "Untitled chat");
}

function status(
  row: StoredThreadSummary,
  pending: readonly GlobalSupervisorPendingRequestSummary[],
): GlobalSupervisorActiveWorkItem["status"] {
  if (pending.length > 0 || (row.status.type === "active" && row.status.activeFlags.length > 0)) {
    return "waitingForUser";
  }
  if (row.status.type === "systemError") {
    return "failed";
  }
  return row.status.type === "active" ? "running" : "completed";
}

function priority(value: GlobalSupervisorActiveWorkItem["status"]): number {
  if (value === "waitingForUser") {
    return STATUS_PRIORITY_WAITING;
  }
  if (value === "failed") {
    return STATUS_PRIORITY_FAILED;
  }
  if (value === "running") {
    return STATUS_PRIORITY_RUNNING;
  }
  return STATUS_PRIORITY_COMPLETED;
}

function isVisibleRootRow(
  row: StoredThreadSummary,
  input: Pick<
    Parameters<typeof projectGlobalSupervisorActiveWork>[0],
    "availableConnectionIds" | "hiddenSupervisor"
  >,
): boolean {
  return (
    !row.archived &&
    row.deleteCommandId === null &&
    row.parentThreadId === null &&
    input.availableConnectionIds.has(row.connectionId) &&
    (row.connectionId !== input.hiddenSupervisor.connectionId ||
      row.remoteThreadId !== input.hiddenSupervisor.threadId)
  );
}

function projectActiveWorkItem(
  row: StoredThreadSummary,
  input: Pick<
    Parameters<typeof projectGlobalSupervisorActiveWork>[0],
    "pendingByThread" | "spokenAttentionByThread"
  >,
): GlobalSupervisorActiveWorkItem {
  const key = qualifiedKey(row.connectionId, row.remoteThreadId);
  const pending = input.pendingByThread.get(key) ?? [];
  return {
    pendingRequests: pending.slice(0, PENDING_REQUEST_MAX_PER_CHAT),
    pendingRequestsTruncated: pending.length > PENDING_REQUEST_MAX_PER_CHAT,
    project: projectName(row),
    spokenAttention: input.spokenAttentionByThread.get(key) ?? { mode: "active" },
    status: status(row, pending),
    summary: safeText(row.preview, "No conversation preview available."),
    target: globalSupervisorQualifiedChatRef(row.connectionId, row.remoteThreadId),
    title: title(row),
    updatedAt: (row.recencyAt ?? row.updatedAt) * MILLISECONDS_PER_SECOND,
  };
}

/** Builds one bounded point-in-time view from the event-maintained catalog. */
export function projectGlobalSupervisorActiveWork(input: {
  readonly availableConnectionIds: ReadonlySet<string>;
  readonly hiddenSupervisor: GlobalSupervisorQualifiedChatRef;
  readonly pendingByThread: PendingByThread;
  readonly rows: readonly StoredThreadSummary[];
  readonly spokenAttentionByThread: ReadonlyMap<string, GlobalSupervisorSpokenAttentionPolicy>;
}): GlobalSupervisorActiveWorkSnapshot {
  let recentCompletions = 0;
  const eligible = input.rows
    .filter((row) => isVisibleRootRow(row, input) && row.status.type !== "notLoaded")
    .map((row) => projectActiveWorkItem(row, input))
    .sort((left, right) => {
      const state = priority(left.status) - priority(right.status);
      return state === 0 ? right.updatedAt - left.updatedAt : state;
    })
    .filter((item) => {
      if (item.status !== "completed") {
        return true;
      }
      recentCompletions += 1;
      return recentCompletions <= RECENT_COMPLETION_MAX_ITEMS;
    });
  return {
    items: eligible.slice(0, ACTIVE_WORK_MAX_ITEMS),
    truncated:
      recentCompletions > RECENT_COMPLETION_MAX_ITEMS ||
      eligible.length > ACTIVE_WORK_MAX_ITEMS ||
      input.rows.length >= GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT,
  };
}

function normalized(value: string | null): string | null {
  const result = value?.trim().toLocaleLowerCase() ?? "";
  return result === "" ? null : result;
}

function matches(value: string, query: string | null): boolean {
  return query === null || value.toLocaleLowerCase().includes(query);
}

type FindQueries = {
  readonly project: string | null;
  readonly title: string | null;
  readonly topic: string | null;
};

function matchesFindInput(
  row: StoredThreadSummary,
  input: Pick<
    Parameters<typeof findGlobalSupervisorChat>[0],
    "availableConnectionIds" | "connectionId" | "hiddenSupervisor"
  >,
  queries: FindQueries,
): boolean {
  return (
    isVisibleRootRow(row, input) &&
    (input.connectionId === null || row.connectionId === input.connectionId) &&
    matches(title(row), queries.title) &&
    matches(row.preview, queries.topic) &&
    matches(`${row.cwd}\n${row.gitOriginUrl ?? ""}`, queries.project)
  );
}

function projectChatMatch(row: StoredThreadSummary): GlobalSupervisorChatMatch {
  return {
    project: projectName(row),
    summary: safeText(row.preview, "No conversation preview available."),
    target: globalSupervisorQualifiedChatRef(row.connectionId, row.remoteThreadId),
    title: title(row),
  };
}

/** Resolves only a unique candidate; every multi-match result stays explicit. */
export function findGlobalSupervisorChat(input: {
  readonly availableConnectionIds: ReadonlySet<string>;
  readonly connectionId: string | null;
  readonly hiddenSupervisor: GlobalSupervisorQualifiedChatRef;
  readonly project: string | null;
  readonly rows: readonly StoredThreadSummary[];
  readonly title: string | null;
  readonly topic: string | null;
}): GlobalSupervisorFindChatResult {
  const queries: FindQueries = {
    project: normalized(input.project),
    title: normalized(input.title),
    topic: normalized(input.topic),
  };
  const candidates = input.rows
    .filter((row) => matchesFindInput(row, input, queries))
    .map(projectChatMatch);
  const sourceTruncated = input.rows.length >= GLOBAL_SUPERVISOR_WORK_CATALOG_LIMIT;
  if (candidates.length === 0 && !sourceTruncated) {
    return { status: "notFound" };
  }
  if (candidates.length === 1 && !sourceTruncated) {
    const chat = candidates[0];
    return chat === undefined ? { status: "notFound" } : { chat, status: "found" };
  }
  return {
    candidates: candidates.slice(0, FIND_CHAT_MAX_RESULTS),
    status: "ambiguous",
    truncated: sourceTruncated || candidates.length > FIND_CHAT_MAX_RESULTS,
  };
}
