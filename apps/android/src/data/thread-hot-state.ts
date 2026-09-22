import { hasUnansweredAsyncQuestion } from "./questionAnswerProjection";
import type { PendingServerRequest } from "./pending-request-types";
import type { StoredThreadSummary } from "./thread-summary-types";

/**
 * Joins the immutable thread index with the small mutable approval head.
 * Screens consume this projection instead of independently deciding whether a
 * thread is running, unread, or waiting for the user.
 */
export function projectThreadHotStates(
  summaries: readonly StoredThreadSummary[],
  pendingRequests: readonly PendingServerRequest[],
): StoredThreadSummary[] {
  const heads = new Map<string, RequestAttention>();
  const closedTurns = new Map(
    summaries.map((row) => [
      `${row.connectionId}\u0000${row.remoteThreadId}`,
      row.closedQuestionTurnId,
    ]),
  );
  for (const request of pendingRequests) {
    const threadId = typeof request.params.threadId === "string" ? request.params.threadId : null;
    if (threadId === null) {
      continue;
    }
    const key = `${request.connectionId}\u0000${threadId}`;
    const head = heads.get(key) ?? { count: 0, input: "unknown" };
    heads.set(key, head);
    addRequestAttention(head, request, closedTurns.get(key));
  }

  return summaries.map((summary) => {
    const head = heads.get(`${summary.connectionId}\u0000${summary.remoteThreadId}`);
    const count = head?.count ?? 0;
    const status = answeredInputStatus(summary.status, questionInputAnswered(summary, head?.input));
    return summary.pendingRequestCount === count && summary.status === status
      ? summary
      : { ...summary, pendingRequestCount: count, status };
  });
}

function answeredInputStatus(
  status: StoredThreadSummary["status"],
  answered: boolean,
): StoredThreadSummary["status"] {
  if (!answered || status.type !== "active" || !status.activeFlags.includes("waitingOnUserInput")) {
    return status;
  }
  return {
    activeFlags: status.activeFlags.filter((flag) => flag !== "waitingOnUserInput"),
    type: "active",
  };
}

type RequestAttention = { count: number; input: "unknown" | "answered" | "pending" };

function addRequestAttention(
  head: RequestAttention,
  request: PendingServerRequest,
  closedTurnId: string | null | undefined,
): void {
  if (request.method !== "item/tool/requestUserInput") {
    head.count += 1;
    return;
  }
  const answered =
    request.state === "resolving" ||
    (typeof request.params.turnId === "string" && request.params.turnId === closedTurnId);
  if (!answered) {
    head.count += 1;
    head.input = "pending";
  } else if (head.input !== "pending") {
    head.input = "answered";
  }
}

function questionInputAnswered(
  summary: StoredThreadSummary,
  input: RequestAttention["input"] | undefined,
): boolean {
  if (input === "pending") {
    return false;
  }
  return (
    input === "answered" ||
    ((summary.pendingQuestion?.itemIds.length ?? 0) > 0 && !hasUnansweredAsyncQuestion(summary))
  );
}
