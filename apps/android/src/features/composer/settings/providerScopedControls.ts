import { readThreadAgent, threadAgentSupports } from "../../../data/threadAgent";
import type { TurnControlsValue } from "../../../data/turn-controls-types";

/**
 * Catalog rows the composer may offer for one conversation.
 *
 * A thread is bound to one provider for its life, so an existing thread offers
 * only that provider's models and permission profiles: a cross-provider choice
 * would otherwise be rejected after the settings update left the composer.
 * Skills are offered only when the thread's agent accepts skill input. A new
 * chat, a legacy thread without a descriptor and unannotated catalog rows keep
 * the full catalog.
 */
export function providerScopedControls(
  controls: TurnControlsValue,
  newChat: boolean,
  thread: unknown,
): TurnControlsValue {
  const agent = newChat ? null : readThreadAgent(thread);
  if (agent === null) {
    return controls;
  }
  return {
    defaults: controls.defaults,
    models: controls.models.filter(
      (model) => model.provider === null || model.provider === agent.provider,
    ),
    permissions: controls.permissions.filter(
      (permission) =>
        permission.providers === null || permission.providers.includes(agent.provider),
    ),
    skills: threadAgentSupports(agent, "input.skillsAndMentions") ? controls.skills : [],
  };
}
