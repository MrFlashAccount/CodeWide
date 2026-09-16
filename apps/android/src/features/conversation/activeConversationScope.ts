import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { type ThreadListItem } from "../threadList/threadListTypes";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useActiveConversationScope({
  destination,
  onClose,
  onExitSearchHistory,
  scopedThreads,
  connections,
  loadedThreadSummaries,
}: {
  destination: ActiveWorkspaceConversationProps["destination"];
  onClose: ActiveWorkspaceConversationProps["onClose"];
  onExitSearchHistory: ActiveWorkspaceConversationProps["onExitSearchHistory"];
  scopedThreads: ActiveWorkspaceConversationProps["scopedThreads"];
  connections: ActiveWorkspaceConversationProps["connections"];
  loadedThreadSummaries: ActiveWorkspaceConversationProps["loadedThreadSummaries"];
}) {
  const newChatDraft = destination.kind === "draft" ? destination.draft : null;
  const searchWindow = destination.kind === "thread" ? destination.searchWindow : null;
  const requestedThreadId =
    destination.kind === "thread"
      ? threadSelectionKey({ serverId: destination.connectionId, id: destination.threadId })
      : null;
  const threadOpenGeneration = destination.generation;
  const closeActiveConversation = onClose;
  const exitSearchHistory = onExitSearchHistory;
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
    newChatDraft?.connectionId ??
    activeThread?.serverId ??
    (destination.kind === "thread" ? destination.connectionId : "");
  const activeConnectionState =
    connections.find((connection) => connection.id === activeConnectionId)?.state ?? "offline";
  const activeRemoteThreadId =
    activeThread?.id ?? (destination.kind === "thread" ? destination.threadId : null);
  const composerThreadId = newChatDraft?.id ?? activeRemoteThreadId;
  const visibleConversationThread: ThreadListItem | null =
    newChatDraft === null
      ? (activeThread ??
        (destination.kind !== "thread"
          ? null
          : {
              id: destination.threadId,
              serverId: destination.connectionId,
              title: "Loading thread…",
              preview: "",
              pinned: false,
              unread: 0,
            }))
      : {
          id: newChatDraft.id,
          serverId: newChatDraft.connectionId,
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
