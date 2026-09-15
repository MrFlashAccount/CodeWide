import { useEvent } from "../../react/useEvent";
import type { SelectWorkspaceThread, ThreadNavigationModel } from "../navigation/threadNavigation";
import { threadSelectionKey } from "../navigation/threadSelection";
import type { ThreadListItem } from "./threadListTypes";
import type { ThreadListMutations } from "../turnActions/turnActionCapabilities";
/** List actions keep selection cleanup separate from canonical thread mutation. */
export function useThreadListActions(
  remote: ThreadListMutations,
  threadNavigation: ThreadNavigationModel,
  setActiveThreadId: SelectWorkspaceThread,
) {
  const toggleListThreadPin = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.setThreadPinned(thread.serverId, thread.id, !thread.pinned);
  });

  const archiveListThread = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.archiveThread(thread.serverId, thread.id);
    if (threadNavigation.current().id === threadSelectionKey(thread)) setActiveThreadId(null);
  });

  const unarchiveListThread = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.unarchiveThread(thread.serverId, thread.id);
    if (threadNavigation.current().id === threadSelectionKey(thread)) setActiveThreadId(null);
  });

  const markListThreadRead = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.markThreadRead(thread.serverId, thread.id);
  });
  return { toggleListThreadPin, archiveListThread, unarchiveListThread, markListThreadRead };
}
