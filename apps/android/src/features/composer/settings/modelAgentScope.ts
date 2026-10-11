import type { TurnControlsValue } from "../../../data/turn-controls-types";
import type { ModelAgentScope } from "../../../ui/TurnControlMenus.types";

/**
 * What the model picker says about the conversation's agent. A thread keeps its
 * provider for life, so a new chat whose catalog offers several providers groups
 * them and says the choice is final. An existing chat, a single-provider or a
 * legacy server gets `null` and the picker shows only the models.
 */
export function modelAgentScope(
  catalog: TurnControlsValue,
  newChat: boolean,
): ModelAgentScope | null {
  if (!newChat) {
    return null;
  }
  const providers = new Set(
    catalog.models.flatMap((model) => (model.provider === null ? [] : [model.provider])),
  );
  return providers.size > 1 ? { kind: "newChat" } : null;
}
