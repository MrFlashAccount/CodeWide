import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

type ActiveThreadStatus = Extract<Thread["status"], { type: "active" }>;

export type StoredThreadSummary = {
  connectionId: string;
  remoteThreadId: string;
  parentThreadId: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
  name: string | null;
  preview: string;
  cwd: string;
  /** Repository identity reported by Codex. Unlike cwd, it is stable across Git worktrees. */
  gitOriginUrl?: string | null;
  updatedAt: number;
  recencyAt: number | null;
  status: Thread["status"];
  pinned: boolean;
  archived: boolean;
  pendingRequestCount: number;
  latestActivityCursor: number;
  lastSeenCursor: number;
  unread: number;
  /**
   * The authoritative empty shell returned by thread/start. Detail storage is
   * on-demand, so keeping the shell with the eager index prevents a new thread
   * from being resumed before it has any rollout to materialize.
   */
  provisionalThread?: Thread | null;
  /** Native outbox command hiding this row until delivery or rollback. */
  deleteCommandId: string | null;
};

/** Repairs persisted or wire summaries at the model boundary. Older cache
 * rows can predate `Thread.status`; `notLoaded` is the only honest state until
 * the background authoritative snapshot replaces it. */
export function normalizeStoredThreadSummary(row: StoredThreadSummary): StoredThreadSummary {
  return {
    ...row,
    parentThreadId: row.parentThreadId ?? null,
    deleteCommandId: row.deleteCommandId ?? null,
    recencyAt: row.recencyAt ?? null,
    status: normalizeThreadStatus(row.status),
  };
}

export function normalizeThreadStatus(value: unknown): Thread["status"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { type: "notLoaded" };
  const status = value as Record<string, unknown>;
  if (status.type === "active") {
    return {
      type: "active",
      activeFlags: Array.isArray(status.activeFlags) ? status.activeFlags as ActiveThreadStatus["activeFlags"] : [],
    };
  }
  if (status.type === "idle" || status.type === "notLoaded" || status.type === "systemError") return { type: status.type };
  return { type: "notLoaded" };
}
