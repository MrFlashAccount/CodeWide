import { useEvent } from "../../react/useEvent";
import type { ThreadChangeScope, ThreadResourcesValue } from "../../data/thread-resource-types";

/** Starts attachment resource loading before handing destination ownership to Router. */
export function useAttachmentVisibility(
  dismissKeyboard: () => void,
  loadResources:
    | ((
        scope?: ThreadChangeScope,
        kind?: "all" | "changes" | "attachments",
      ) => Promise<ThreadResourcesValue>)
    | undefined,
  openChanges: () => void,
  openAttachments: () => void,
) {
  const openThreadResources = useEvent((kind: "changes" | "attachments") => {
    if (kind === "changes") {
      openChanges();
      return;
    }
    dismissKeyboard();
    void loadResources?.(undefined, "attachments").catch(() => undefined);
    openAttachments();
  });
  return { openThreadResources };
}
