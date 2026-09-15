import { useEvent } from "../../react/useEvent";
import type { SelectWorkspaceThread, ThreadNavigationModel } from "./threadNavigation";

/** Destination-only navigation intents never subscribe the workspace shell to selection. */
export function useConversationNavigationActions(
  threadNavigation: ThreadNavigationModel,
  defaultDesktopThreadId: string | null,
  setActiveThreadId: SelectWorkspaceThread,
) {
  const exitSearchHistory = useEvent(() => threadNavigation.exitSearch());

  const commitDefaultDesktopThread = useEvent(() => {
    if (defaultDesktopThreadId === null || threadNavigation.destination$.peek().kind !== "empty")
      return;
    threadNavigation.select(defaultDesktopThreadId);
  });

  const closeActiveConversation = () => {
    setActiveThreadId(null);
  };
  return { exitSearchHistory, commitDefaultDesktopThread, closeActiveConversation };
}
