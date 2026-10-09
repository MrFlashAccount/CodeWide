import { readThreadAgent, threadAgentDeclares } from "../../../data/threadAgent";
import type { TurnControlsValue } from "../../../data/turn-controls-types";
import type { ModelAgentScope } from "../../../ui/TurnControlMenus.types";

/**
 * What the model picker says about the conversation's agent. A thread keeps its
 * provider for life, so a new chat whose catalog offers several providers groups
 * them and says the choice is final; an existing thread with an agent descriptor
 * names its agent and whether a fork can switch it. A single-provider or legacy
 * server gets `null` and the picker looks as before.
 */
export function modelAgentScope(
  catalog: TurnControlsValue,
  newChat: boolean,
  thread: unknown,
): ModelAgentScope | null {
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
        canFork: threadAgentDeclares(agent, "threads.crossProviderFork"),
        kind: "thread",
        providerName: agent.providerName,
      };
}
