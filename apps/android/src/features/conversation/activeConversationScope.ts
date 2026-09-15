import { useConversationNavigationActions } from "../navigation/conversationNavigationActions";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import { parseThreadSelectionKey, threadSelectionKey } from "../navigation/threadSelection";
import { type ThreadListItem } from "../threadList/threadListTypes";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useActiveConversationScope({
  destination,
  threadNavigation,
  defaultDesktopThreadId,
  setActiveThreadId,
  scopedThreads,
  activeServerId,
  connections,
  loadedThreadSummaries,
}: {
  destination: ActiveWorkspaceConversationProps["destination"];
  threadNavigation: ActiveWorkspaceConversationProps["threadNavigation"];
  defaultDesktopThreadId: ActiveWorkspaceConversationProps["defaultDesktopThreadId"];
  setActiveThreadId: ActiveWorkspaceConversationProps["onSelectThread"];
  scopedThreads: ActiveWorkspaceConversationProps["scopedThreads"];
  activeServerId: ActiveWorkspaceConversationProps["activeServerId"];
  connections: ActiveWorkspaceConversationProps["connections"];
  loadedThreadSummaries: ActiveWorkspaceConversationProps["loadedThreadSummaries"];
}) {
  const newChatDraft = destination.kind === "draft" ? destination.draft : null;
  const searchWindow = destination.kind === "thread" ? destination.searchWindow : null;
  const requestedThreadId = destination.kind === "thread" ? destination.key : null;
  const requestedThreadTarget = parseThreadSelectionKey(requestedThreadId);
  const threadOpenGeneration = destination.generation;
  const { exitSearchHistory, commitDefaultDesktopThread, closeActiveConversation } =
    useConversationNavigationActions(threadNavigation, defaultDesktopThreadId, setActiveThreadId);
  const selectedThread =
    requestedThreadId === null
      ? null
      : (scopedThreads.find((thread) => threadSelectionKey(thread) === requestedThreadId) ?? null);
  const pendingThreadSelection = requestedThreadId !== null && selectedThread === null;
  const activeThread = newChatDraft === null ? selectedThread : null;
  const activeThreadId =
    activeThread === null
      ? pendingThreadSelection
        ? requestedThreadId
        : null
      : threadSelectionKey(activeThread);
  const activeThreadKey =
    activeThread === null ? requestedThreadId : threadSelectionKey(activeThread);
  const activeConnectionId =
    newChatDraft?.serverId ??
    activeThread?.serverId ??
    requestedThreadTarget?.connectionId ??
    (activeServerId === ALL_SERVERS_ID ? "" : activeServerId);
  const activeConnectionState =
    connections.find((connection) => connection.id === activeConnectionId)?.state ?? "offline";
  const activeRemoteThreadId = activeThread?.id ?? requestedThreadTarget?.threadId ?? null;
  const composerThreadId = newChatDraft?.id ?? activeRemoteThreadId;
  const visibleConversationThread: ThreadListItem | null =
    newChatDraft === null
      ? (activeThread ??
        (requestedThreadTarget === null
          ? null
          : {
              id: requestedThreadTarget.threadId,
              serverId: requestedThreadTarget.connectionId,
              title: "Loading thread…",
              preview: "",
              pinned: false,
              unread: 0,
            }))
      : {
          id: newChatDraft.id,
          serverId: newChatDraft.serverId,
          title: "New Chat",
          preview: "",
          time: "now",
          pinned: false,
          unread: 0,
        };
  const activeStoredThread =
    loadedThreadSummaries.find(
      (candidate) =>
        candidate.connectionId === activeConnectionId &&
        candidate.remoteThreadId === activeRemoteThreadId,
    ) ?? null;
  const activeCwd = newChatDraft?.cwd ?? activeStoredThread?.cwd ?? "/workspace";
  return {
    newChatDraft,
    searchWindow,
    requestedThreadId,
    threadOpenGeneration,
    exitSearchHistory,
    commitDefaultDesktopThread,
    closeActiveConversation,
    activeThread,
    activeThreadId,
    activeThreadKey,
    activeConnectionId,
    activeConnectionState,
    activeRemoteThreadId,
    composerThreadId,
    visibleConversationThread,
    activeStoredThread,
    activeCwd,
  };
}
