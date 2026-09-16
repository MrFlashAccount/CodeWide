import type { QueuedPrompt } from "../../data/thread-delivery-state";
import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";

export function useQueueVisibility(composerScope: string, queuedPrompts: readonly QueuedPrompt[]) {
  const [inlineQueueExpanded, setInlineQueueExpanded] = useConversationState(
    composerScope,
    () => false,
  );

  const closeInlineQueueOverlay = useEvent(() => setInlineQueueExpanded(false));

  const toggleInlineQueueOverlay = useEvent(() => {
    if (inlineQueueExpanded) {
      closeInlineQueueOverlay();
      return;
    }
    if (queuedPrompts.length === 0) return;
    setInlineQueueExpanded(true);
  });
  return {
    inlineQueueExpanded,
    setInlineQueueExpanded,
    closeInlineQueueOverlay,
    toggleInlineQueueOverlay,
  };
}
