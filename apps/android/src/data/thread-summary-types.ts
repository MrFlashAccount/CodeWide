import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

export type StoredThreadSummary = {
  connectionId: string;
  remoteThreadId: string;
  parentThreadId?: string | null;
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
  deleteCommandId?: string | null;
};
