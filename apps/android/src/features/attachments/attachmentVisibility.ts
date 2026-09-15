import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";
import type { ThreadChangeScope, ThreadResourcesValue } from "../../data/thread-resource-types";

/** Sheet selection is local; canonical resource loading remains below the feature. */
export function useAttachmentVisibility(
  composerScope: string,
  dismissKeyboard: () => void,
  loadResources:
    | ((
        scope?: ThreadChangeScope,
        kind?: "all" | "changes" | "attachments",
      ) => Promise<ThreadResourcesValue>)
    | undefined,
  openChanges: () => void,
) {
  const [threadResourceSheet, setThreadResourceSheet] = useConversationState<
    "changes" | "attachments" | null
  >(composerScope, () => null);
  const openThreadResources = useEvent((kind: "changes" | "attachments") => {
    if (kind === "changes") {
      openChanges();
      return;
    }
    dismissKeyboard();
    setThreadResourceSheet("attachments");
    void loadResources?.(undefined, "attachments").catch(() => undefined);
  });
  const closeThreadResources = useEvent(() => setThreadResourceSheet(null));
  return { threadResourceSheet, openThreadResources, closeThreadResources };
}
