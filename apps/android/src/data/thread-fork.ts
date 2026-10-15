import type { ThreadForkParams } from "@codewide/codex-protocol/v0.155.1/v2";
import type { AgentProviderId } from "./threadAgent";

/** How much of the source thread's history the fork keeps. */
export type ThreadForkBoundary =
  | { kind: "all" }
  | { kind: "through"; turnId: string }
  | { kind: "before"; turnId: string };

/**
 * The agent and settings the fork continues with: a provider from the
 * Companion's provider-aware model catalog, one of its models, its thinking
 * level and service tier. `null` keeps the source thread's agent and settings.
 */
export type ThreadForkTarget = {
  /** Thinking level; `null` leaves the model's default (or a model without levels). */
  readonly effort: string | null;
  readonly model: string;
  readonly provider: AgentProviderId;
  /** Catalog service tier id (Fast or explicit standard); `null` leaves the server default. */
  readonly serviceTier: string | null;
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
    // The fork is imported as metadata only and pages its history like any other
    // thread. Codex deprecates full-history fork responses for paginated threads and
    // rejects them outright for ephemeral forks.
    excludeTurns: true,
    threadId: normalizedThreadId,
    ...(boundary.kind === "through"
      ? { lastTurnId: requiredId(boundary.turnId, "Last turn id") }
      : boundary.kind === "before"
        ? { beforeTurnId: requiredId(boundary.turnId, "Before turn id") }
        : {}),
    ...(target === null ? {} : forkTargetParams(target)),
  };
}

/**
 * The target's `thread/fork` fields, in the same wire shape as `thread/start`:
 * the thinking level as the `model_reasoning_effort` config override and the
 * service tier as `serviceTier`, each only when chosen.
 */
function forkTargetParams(target: ThreadForkTarget): Partial<CodewideThreadForkParams> {
  return {
    codewideAgentProvider: target.provider,
    model: requiredId(target.model, "Model"),
    ...(target.effort === null ? {} : { config: { model_reasoning_effort: target.effort } }),
    ...(target.serviceTier === null ? {} : { serviceTier: target.serviceTier }),
  };
}

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    throw new Error(`${label} is required`);
  }
  return normalized;
}
