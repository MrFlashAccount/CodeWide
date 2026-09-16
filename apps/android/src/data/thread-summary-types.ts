import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { unknownRecord } from "./unknownRecord";

type ActiveThreadStatus = Extract<Thread["status"], { type: "active" }>;

export type StoredThreadSummary = {
  agentNickname?: string | null;
  agentRole?: string | null;
  archived: boolean;
  connectionId: string;
  cwd: string;
  /** Native outbox command hiding this row until delivery or rollback. */
  deleteCommandId: string | null;
  /** Repository identity reported by Codex. Unlike cwd, it is stable across Git worktrees. */
  gitOriginUrl?: string | null;
  lastSeenCursor: number;
  latestActivityCursor: number;
  name: string | null;
  parentThreadId: string | null;
  pendingRequestCount: number;
  pinned: boolean;
  preview: string;
  /**
   * The authoritative empty shell returned by thread/start. Detail storage is
   * on-demand, so keeping the shell with the eager index prevents a new thread
   * from being resumed before it has any rollout to materialize.
   */
  provisionalThread?: Thread | null;
  recencyAt: number | null;
  remoteThreadId: string;
  status: Thread["status"];
  unread: number;
  updatedAt: number;
};

/** Sanitizes persisted or wire summaries at the model boundary. `notLoaded`
 * is the only honest lifecycle when an input does not contain a valid status. */
export function normalizeStoredThreadSummary(row: StoredThreadSummary): StoredThreadSummary {
  return {
    ...row,
    deleteCommandId: row.deleteCommandId ?? null,
    parentThreadId: row.parentThreadId ?? null,
    recencyAt: row.recencyAt ?? null,
    status: normalizeThreadStatus(row.status),
  };
}

export function normalizeThreadStatus(value: unknown): Thread["status"] {
  const status = unknownRecord(value);
  if (status === null) {
    return { type: "notLoaded" };
  }
  if (status.type === "active") {
    return {
      activeFlags: Array.isArray(status.activeFlags)
        ? status.activeFlags.filter(isActiveThreadStatus)
        : [],
      type: "active",
    };
  }
  if (status.type === "idle" || status.type === "notLoaded" || status.type === "systemError") {
    return { type: status.type };
  }
  return { type: "notLoaded" };
}

function isActiveThreadStatus(value: unknown): value is ActiveThreadStatus["activeFlags"][number] {
  return value === "waitingOnApproval" || value === "waitingOnUserInput";
}
