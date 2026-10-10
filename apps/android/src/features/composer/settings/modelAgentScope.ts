import { readThreadAgent, threadAgentDeclares } from "../../../data/threadAgent";
import type { TurnControlsValue } from "../../../data/turn-controls-types";
import type { ModelAgentScope } from "../../../ui/TurnControlMenus.types";

/**
 * What the model picker says about the conversation's agent. A thread keeps its
 * provider for life, so a new chat whose catalog offers several providers groups
 * them and says the choice is final; an existing thread with an agent descriptor
 * names its agent and offers the "Fork into" picker when a fork can switch it. A single-provider or legacy
 * server gets `null` and the picker looks as before.
 */
export function modelAgentScope({
  catalog,
  forkIntoAgent,
  newChat,
  thread,
}: {
  readonly catalog: TurnControlsValue;
  /** Opens the thread's "Fork into" picker; absent when the conversation offers none. */
  readonly forkIntoAgent: (() => void) | undefined;
  readonly newChat: boolean;
  readonly thread: unknown;
}): ModelAgentScope | null {
  if (newChat) {
    const providers = new Set(
      catalog.models.flatMap((model) => (model.provider === null ? [] : [model.provider])),
    );
    return providers.size > 1 ? { kind: "newChat" } : null;
  }
  const agent = readThreadAgent(thread);
  return agent === null
    ? null
    : {
        forkIntoAgent:
          forkIntoAgent !== undefined && threadAgentDeclares(agent, "threads.crossProviderFork")
            ? forkIntoAgent
            : null,
        kind: "thread",
        providerName: agent.providerName,
      };
}
