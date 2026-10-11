import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";
import type { ForkTargetChoice, ReadForkTargets } from "./forkTargets";

/**
 * Conversation-scoped owner of the "Fork into" picker. The thread header menu
 * renders the picker; the header's "Fork thread" action and the composer's
 * model picker both open it. Choices are read from the catalog when the user
 * asks to fork, never during render.
 */
export type ForkTargetPicker = {
  readonly closeForkTargets: () => void;
  /** The rows of the open picker; `null` while it is closed. */
  readonly forkChoices: readonly ForkTargetChoice[] | null;
  /**
   * Opens the picker with the thread's targets. Returns `false` when the
   * thread has no picker (a legacy or same-agent-only thread forks at once).
   */
  readonly openForkTargets: (readTargets: ReadForkTargets) => boolean;
};

/** Binds the picker to one conversation activation. */
export function useForkTargetPicker(composerScope: string): ForkTargetPicker {
  const [forkChoices, setForkChoices] = useConversationState<readonly ForkTargetChoice[] | null>(
    composerScope,
    () => null,
  );
  const openForkTargets = useEvent((readTargets: ReadForkTargets) => {
    const choices = readTargets();
    if (choices === null) {
      return false;
    }
    setForkChoices(choices);
    return true;
  });
  const closeForkTargets = useEvent(() => {
    setForkChoices(null);
  });
  return { closeForkTargets, forkChoices, openForkTargets };
}
