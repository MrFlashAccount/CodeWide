import type { ThreadForkParams } from "@codewide/codex-protocol/v0.147.0/v2";

export type ThreadForkBoundary =
  | { kind: "all" }
  | { kind: "through"; turnId: string }
  | { kind: "before"; turnId: string };

export type ThreadForkOptions = {
  boundary: ThreadForkBoundary;
  ephemeral: boolean;
};

export function buildThreadForkParams(
  threadId: string,
  options: ThreadForkOptions,
): ThreadForkParams {
  const normalizedThreadId = requiredId(threadId, "Thread id");
  const boundary = options.boundary;
  return {
    threadId: normalizedThreadId,
    excludeTurns: false,
    ephemeral: options.ephemeral,
    ...(boundary.kind === "through"
      ? { lastTurnId: requiredId(boundary.turnId, "Last turn id") }
      : boundary.kind === "before"
        ? { beforeTurnId: requiredId(boundary.turnId, "Before turn id") }
        : {}),
  };
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required`);
  return normalized;
}
