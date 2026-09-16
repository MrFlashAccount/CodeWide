import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import type { ThreadListItem } from "../threadList/threadListTypes";
import type { ActiveWorkspaceConversationProps } from "./ConversationWorkspace.types";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useActiveConversationScope({
  connections,
  destination,
  loadedThreadSummaries,
  onClose,
  onExitSearchHistory,
  scopedThreads,
}: {
  connections: ActiveWorkspaceConversationProps["connections"];
  destination: ActiveWorkspaceConversationProps["destination"];
  loadedThreadSummaries: ActiveWorkspaceConversationProps["loadedThreadSummaries"];
  onClose: ActiveWorkspaceConversationProps["onClose"];
  onExitSearchHistory: ActiveWorkspaceConversationProps["onExitSearchHistory"];
  scopedThreads: ActiveWorkspaceConversationProps["scopedThreads"];
}) {
  const newChatDraft = destination.kind === "draft" ? destination.draft : null;
  const searchWindow = destination.kind === "thread" ? destination.searchWindow : null;
  const requestedThreadId =
    destination.kind === "thread"
      ? threadSelectionKey({ id: destination.threadId, serverId: destination.connectionId })
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
              pinned: false,
              preview: "",
              serverId: destination.connectionId,
              title: "Loading thread…",
              unread: 0,
            }))
      : {
          id: newChatDraft.id,
          pinned: false,
          preview: "",
          serverId: newChatDraft.connectionId,
          time: "now",
          title: "New Chat",
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
    activeConnectionId,
    activeConnectionState,
    activeCwd,
    activeRemoteThreadId,
    activeStoredThread,
    activeThread,
    activeThreadId,
    activeThreadKey,
    closeActiveConversation,
    composerThreadId,
    exitSearchHistory,
    newChatDraft,
    requestedThreadId,
    searchWindow,
    threadOpenGeneration,
    visibleConversationThread,
  };
}
