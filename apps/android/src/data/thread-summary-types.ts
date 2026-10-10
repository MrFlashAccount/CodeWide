import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { normalizeStoredThreadAgent, type ThreadAgent } from "./threadAgent";
import { validPinCursor } from "./threadPinState";
import { unknownRecord } from "./unknownRecord";

type ActiveThreadStatus = Extract<Thread["status"], { type: "active" }>;

export type StoredThreadSummary = {
  agentNickname?: string | null;
  agentRole?: string | null;
  archived: boolean;
  /** A terminal turn cannot reopen question attention through late item replay. */
  closedQuestionTurnId?: string | null;
  /**
   * Bound agent provider and declared capabilities from `Thread.codewideAgent`.
   * Absent in rows persisted before this field and `null` for legacy Companions;
   * both mean a Codex thread with every capability.
   */
  codewideAgent?: ThreadAgent | null;
  connectionId: string;
  cwd: string;
  /** Native outbox command hiding this row until delivery or rollback. */
  deleteCommandId: string | null;
  /** First completed agent turn observed after the thread became unread. */
  firstUnreadAgentTurnId?: string | null;
  /** Repository identity reported by Codex. Unlike cwd, it is stable across Git worktrees. */
  gitOriginUrl?: string | null;
  lastSeenCursor: number;
  latestActivityCursor: number;
  name: string | null;
  parentThreadId: string | null;
  /** Latest observed async question opportunity; newer user input retires it. */
  pendingQuestion?: QuestionOpportunity | null;
  pendingRequestCount: number;
  /** Last server-owned pin cursor; absent only in retired local-pin cache rows. */
  pinCursor?: number;
  pinned: boolean;
  preview: string;
  /** Last material event applied to this row; absent only in older persisted summaries. */
  projectionCursor?: number;
  /**
   * The authoritative empty shell returned by thread/start. Detail storage is
   * on-demand, so keeping the shell with the eager index prevents a new thread
   * from being resumed before it has any rollout to materialize.
   */
  provisionalThread?: Thread | null;
  recencyAt: number | null;
  remoteThreadId: string;
  /** Locally skipped question identities in one turn; contains no answer text. */
  skippedQuestions?: QuestionOpportunity | null;
  status: Thread["status"];
  /** Questions with a natively admitted answer; failures restore attention. */
  submittedQuestions?: QuestionOpportunity | null;
  unread: number;
  updatedAt: number;
};

/** Sanitizes persisted or wire summaries at the model boundary. `notLoaded`
 * is the only honest lifecycle when an input does not contain a valid status. */
export function normalizeStoredThreadSummary(row: StoredThreadSummary): StoredThreadSummary {
  return {
    ...row,
    codewideAgent: normalizeStoredThreadAgent(row.codewideAgent),
    deleteCommandId: row.deleteCommandId ?? null,
    firstUnreadAgentTurnId:
      typeof row.firstUnreadAgentTurnId === "string" && row.firstUnreadAgentTurnId !== ""
        ? row.firstUnreadAgentTurnId
        : null,
    parentThreadId: row.parentThreadId ?? null,
    pinCursor: validPinCursor(row.pinCursor) ? row.pinCursor : 0,
    pinned: validPinCursor(row.pinCursor) && row.pinned,
    projectionCursor: threadSummaryProjectionCursor(row),
    recencyAt: row.recencyAt ?? null,
    status: normalizeThreadStatus(row.status),
  };
}

/** Reads the material-event version, including persisted summaries from before this field existed. */
export function threadSummaryProjectionCursor(row: StoredThreadSummary): number {
  const cursor = row.projectionCursor;
  return typeof cursor === "number" && Number.isSafeInteger(cursor) && cursor >= 0
    ? cursor
    : row.latestActivityCursor;
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

/** Question identity shared by catalog attention and local dismissal. */
export type QuestionOpportunity = {
  readonly itemIds: readonly string[];
  readonly turnId: string;
};
