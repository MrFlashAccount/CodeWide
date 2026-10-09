/**
 * Targets offered by "Fork thread" when the Companion can fork into another agent.
 *
 * A thread whose agent declares `threads.crossProviderFork` may continue its fork
 * with any model of the provider-aware catalog. Without that capability, or for a
 * legacy thread, there is no picker and the fork keeps today's same-agent request.
 * The same-agent choice exists only while the agent declares `threads.fork`.
 */
import type { ThreadForkTarget } from "../../data/thread-fork";
import { readThreadAgent, threadAgentDeclares, type ThreadAgent } from "../../data/threadAgent";
import type { TurnControlsValue } from "../../data/turn-controls-types";

type CatalogModel = TurnControlsValue["models"][number];

/** One row of the fork target picker. */
export type ForkTargetChoice = {
  /** Stable row key. */
  readonly id: string;
  readonly subtitle: string;
  /** `null` forks with the source thread's agent and settings (the plain fork). */
  readonly target: ThreadForkTarget | null;
  readonly title: string;
};

/** `null`: no picker, fork directly with the same agent. */
export type ForkTargetChoices = readonly ForkTargetChoice[] | null;

/** Reads the fork targets of a thread at the moment the user asks to fork. */
export type ReadForkTargets = () => ForkTargetChoices;

/** Whether the thread offers a fork at all: its own fork or a fork into another agent. */
export function threadOffersFork(agent: ThreadAgent | null): boolean {
  return (
    agent === null ||
    threadAgentDeclares(agent, "threads.fork") ||
    threadAgentDeclares(agent, "threads.crossProviderFork")
  );
}

/** Display label of a catalog provider: the thread's own provider name, otherwise its id. */
function providerLabel(agent: ThreadAgent, provider: string): string {
  if (provider === agent.provider) {
    return agent.providerName;
  }
  return `${provider.slice(0, 1).toUpperCase()}${provider.slice(1)}`;
}

/** The picker rows for `thread` from the catalog `models`, or `null` without a picker. */
export function forkTargetChoices(
  thread: unknown,
  models: readonly CatalogModel[],
): ForkTargetChoices {
  const agent = readThreadAgent(thread);
  if (agent === null || !threadAgentDeclares(agent, "threads.crossProviderFork")) {
    return null;
  }
  const sameAgent = threadAgentDeclares(agent, "threads.fork");
  const targets = models.flatMap((model): ForkTargetChoice[] => {
    const provider = model.provider;
    if (provider === null || (!sameAgent && provider === agent.provider)) {
      return [];
    }
    return [
      {
        id: `${provider}:${model.id}`,
        subtitle: providerLabel(agent, provider),
        target: { model: model.id, provider },
        title: model.label,
      },
    ];
  });
  if (!sameAgent) {
    return targets;
  }
  return [
    {
      id: "same-agent",
      subtitle: `${agent.providerName} with the current settings`,
      target: null,
      title: "Same agent",
    },
    ...targets,
  ];
}
