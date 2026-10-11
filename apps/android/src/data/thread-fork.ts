import type { ThreadForkParams } from "@codewide/codex-protocol/v0.155.1/v2";
import type { AgentProviderId } from "./threadAgent";

type ThreadForkBoundary =
  | { kind: "all" }
  | { kind: "through"; turnId: string }
  | { kind: "before"; turnId: string };

/**
 * Another agent to continue the fork with: a provider from the Companion's
 * provider-aware model catalog and one of its models. `null` keeps the source
 * thread's agent and settings.
 */
export type ThreadForkTarget = {
  readonly model: string;
  readonly provider: AgentProviderId;
};

export type ThreadForkOptions = {
  boundary: ThreadForkBoundary;
  ephemeral: boolean;
  target: ThreadForkTarget | null;
};

/**
 * `thread/fork` params. `codewideAgentProvider` is the Companion's extension field
 * that binds the fork to another provider; it is sent only with a target, so a fork
 * without one is the same request as before cross-provider forks existed.
 */
export type CodewideThreadForkParams = ThreadForkParams & {
  readonly codewideAgentProvider?: string;
};

export function buildThreadForkParams(
  threadId: string,
  options: ThreadForkOptions,
): CodewideThreadForkParams {
  const normalizedThreadId = requiredId(threadId, "Thread id");
  const boundary = options.boundary;
  const target = options.target;
  return {
    ephemeral: options.ephemeral,
    excludeTurns: false,
    threadId: normalizedThreadId,
    ...(boundary.kind === "through"
      ? { lastTurnId: requiredId(boundary.turnId, "Last turn id") }
      : boundary.kind === "before"
        ? { beforeTurnId: requiredId(boundary.turnId, "Before turn id") }
        : {}),
    ...(target === null
      ? {}
      : { codewideAgentProvider: target.provider, model: requiredId(target.model, "Model") }),
  };
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`${label} is required`);
  }
  return normalized;
}
