import { useEvent } from "../../react/useEvent";
/** V1 turnActions owner, extracted without changing interaction or resource lifetime. */
import * as Clipboard from "expo-clipboard";
import { Platform, ToastAndroid } from "react-native";

export async function copySessionId(sessionId: string): Promise<void> {
  await Clipboard.setStringAsync(sessionId);
  if (Platform.OS === "android") ToastAndroid.show("Session ID copied", ToastAndroid.SHORT);
}

import type { ThreadForkOptions } from "../../data/thread-fork";
import { threadSelectionKey } from "../navigation/threadSelection";
import type { ActiveThreadMutations } from "./turnActionCapabilities";
export function useActiveThreadActions(
  remote: ActiveThreadMutations,
  hasActiveThread: boolean,
  activeConnectionId: string,
  activeRemoteThreadId: string | null,
  setActiveThreadId: (id: string) => void,
) {
  const forkCurrentThread = useEvent(async (options: ThreadForkOptions): Promise<void> => {
    if (!hasActiveThread || activeRemoteThreadId === null || activeConnectionId === "")
      throw new Error("No thread selected");
    const forkedId = await remote.forkThread(activeConnectionId, activeRemoteThreadId, options);
    setActiveThreadId(threadSelectionKey({ serverId: activeConnectionId, id: forkedId }));
  });

  const markActiveThreadRead = useEvent(() => {
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) return;
    void remote.markThreadRead(activeConnectionId, activeRemoteThreadId).catch(() => undefined);
  });
  return { forkCurrentThread, markActiveThreadRead };
}

import type { SelectWorkspaceThread } from "../navigation/threadNavigation";
import type { ThreadMutations } from "./turnActionCapabilities";
export function useThreadMutationActions(
  remote: ThreadMutations,
  activeConnectionId: string,
  activeRemoteThreadId: string | null,
  hasActiveThread: boolean,
  pinned: boolean,
  setActiveThreadId: SelectWorkspaceThread,
  onShowActiveThreads: () => void,
) {
  const onRename = useEvent(async (name: string) => {
    if (activeRemoteThreadId !== null)
      await remote.renameThread(activeConnectionId, activeRemoteThreadId, name);
  });
  const onArchive = useEvent(async () => {
    if (activeRemoteThreadId !== null)
      await remote.archiveThread(activeConnectionId, activeRemoteThreadId);
    setActiveThreadId(null);
  });
  const onUnarchive = useEvent(async () => {
    if (activeRemoteThreadId !== null)
      await remote.unarchiveThread(activeConnectionId, activeRemoteThreadId);
    onShowActiveThreads();
    setActiveThreadId(null);
  });
  const onDelete = useEvent(async () => {
    if (activeRemoteThreadId !== null)
      await remote.deleteThread(activeConnectionId, activeRemoteThreadId);
    setActiveThreadId(null);
  });
  const onTogglePin = useEvent(async () => {
    if (activeRemoteThreadId === null || !hasActiveThread) return;
    await remote.setThreadPinned(activeConnectionId, activeRemoteThreadId, !pinned);
  });
  return { onRename, onArchive, onUnarchive, onDelete, onTogglePin };
}
