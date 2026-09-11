import { useLayoutEffect } from "react";

import type { SearchConversationWindow } from "./search-conversation-window";

/** Cancels page continuation when the selected search resource loses its view. */
export function useSearchConversationWindowLifecycle(window: SearchConversationWindow | null): void {
  useLayoutEffect(() => () => window?.cancelViewportFill(), [window]);
}
