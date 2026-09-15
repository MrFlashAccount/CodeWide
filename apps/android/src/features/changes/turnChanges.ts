import type { ThreadItem } from "@codewide/codex-protocol/v0.147.0/v2";
import { useEvent } from "../../react/useEvent";
import { turnItemChanges } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";

export function useTurnChangesLoader(
  loadTurnItems: (connectionId: string, threadId: string, turnId: string) => Promise<ThreadItem[]>,
) {
  const loadTurnChanges = useEvent(async (target: TurnChangesTarget) =>
    turnItemChanges(await loadTurnItems(target.connectionId, target.threadId, target.turnId)),
  );
  return { loadTurnChanges };
}
