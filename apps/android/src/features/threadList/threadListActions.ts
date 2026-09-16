import { useEvent } from "../../react/useEvent";
import {
  threadSelectionKey,
  type SelectWorkspaceThread,
} from "../../services/threads/threadRouteParams";
import type { ThreadListItem } from "./threadListTypes";
import type { ThreadListMutations } from "../turnActions/turnActionCapabilities";
/** List actions keep selection cleanup separate from canonical thread mutation. */
export function useThreadListActions(
  remote: ThreadListMutations,
  selectedThreadKey: string | null,
  setActiveThreadId: SelectWorkspaceThread,
) {
  const toggleListThreadPin = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.setThreadPinned(thread.serverId, thread.id, !thread.pinned);
  });

  const archiveListThread = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.archiveThread(thread.serverId, thread.id);
    if (selectedThreadKey === threadSelectionKey(thread)) setActiveThreadId(null);
  });

  const unarchiveListThread = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.unarchiveThread(thread.serverId, thread.id);
    if (selectedThreadKey === threadSelectionKey(thread)) setActiveThreadId(null);
  });

  const markListThreadRead = useEvent(async (thread: ThreadListItem): Promise<void> => {
    await remote.markThreadRead(thread.serverId, thread.id);
  });
  return { toggleListThreadPin, archiveListThread, unarchiveListThread, markListThreadRead };
}
