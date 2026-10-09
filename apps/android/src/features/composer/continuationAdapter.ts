import { unknownRecord } from "../../data/unknownRecord";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import { isRejectedContinuation, UnconfirmedContinuationError } from "./continuationFailure";

type ContinuationTransport = {
  readonly getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
};
type ContinuationRequest = {
  readonly operation: Promise<void>;
  readonly sourceTurnId: string;
};

/** Starts a new turn from existing history without manufacturing a user message. */
export function createComposerContinuationAdapter(
  transport: ContinuationTransport,
): (connectionId: string, threadId: string, sourceTurnId: string) => Promise<void> {
  const requests = new Map<string, ContinuationRequest>();
  return async (connectionId, threadId, sourceTurnId): Promise<void> => {
    const key = `${connectionId}\u0000${threadId}`;
    const previous = requests.get(key);
    if (previous?.sourceTurnId === sourceTurnId) {
      await previous.operation;
      return;
    }
    const session = transport.getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    // Keep admission synchronous across conversation remounts. Empty turns have
    // neither a user-message receipt nor an upstream idempotency key.
    const operation = continueTurn({ session, sourceTurnId, threadId, transport });
    requests.set(key, { operation, sourceTurnId });
    try {
      await operation;
    } catch (error) {
      if (
        !(error instanceof UnconfirmedContinuationError) &&
        requests.get(key)?.sourceTurnId === sourceTurnId
      ) {
        requests.delete(key);
      }
      throw error;
    }
  };
}

async function continueTurn({
  session,
  sourceTurnId,
  threadId,
  transport,
}: {
  readonly session: WorkspaceSyncSession;
  readonly sourceTurnId: string;
  readonly threadId: string;
  readonly transport: ContinuationTransport;
}): Promise<void> {
  const page = await transport.rpcAfterAttach<unknown>(session, "thread/turns/list", {
    itemsView: "summary",
    limit: 1,
    sortDirection: "desc",
    threadId,
  });
  verifySourceTurn(page, sourceTurnId);
  try {
    const response = await transport.rpcAfterAttach<unknown>(session, "turn/start", {
      input: [],
      threadId,
    });
    verifyStartedTurn(response);
  } catch (error) {
    if (isRejectedContinuation(error)) {
      throw error;
    }
    // Companion's -32040 includes uncertain upstream failures. A JSON-RPC error
    // alone does not prove that turn/start was rejected before execution.
    throw new UnconfirmedContinuationError(error);
  }
}

function verifySourceTurn(value: unknown, sourceTurnId: string): void {
  const page = unknownRecord(value);
  if (!Array.isArray(page?.data)) {
    throw new Error("Could not verify the latest turn");
  }
  const latest = unknownRecord(page.data[0]);
  if (
    latest?.id !== sourceTurnId ||
    (latest.status !== "interrupted" && latest.status !== "failed")
  ) {
    throw new Error("This response is no longer available to continue");
  }
}

function verifyStartedTurn(value: unknown): void {
  const response = unknownRecord(value);
  const turn = unknownRecord(response?.turn);
  if (typeof turn?.id !== "string" || turn.id === "" || turn.status !== "inProgress") {
    throw new Error("Invalid turn/start confirmation");
  }
}
