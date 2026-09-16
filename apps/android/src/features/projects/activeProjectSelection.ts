import type { StoredConnection } from "../../data/connection-profile-types";
import type { RemoteDirectoryEntry, RemoteProject } from "../../data/remote-projects";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import type { WorkspaceSupport } from "../../data/workspace-creation";
import { useEvent } from "../../react/useEvent";
import { useAsyncResource } from "../../rendering/async-resource-store";
import type { NewThreadDraft } from "../../services/threads/newThreadService";
import {
  threadSelectionKey,
  type SelectWorkspaceThread,
} from "../../services/threads/threadRouteParams";
import { useRemoteProjectCatalog } from "./useRemoteProjectCatalog";
/** Project commands retain the original thread/detail and workspace authorities. */
export type ActiveProjectCapability = {
  addProject: (connectionId: string, path: string) => Promise<RemoteProject>;
  readonly connections: StoredConnection[];
  deleteThread: (connectionId: string, threadId: string) => Promise<void>;
  inspectWorkspace: (connectionId: string, workspace: string) => Promise<WorkspaceSupport | null>;
  listProjects: (connectionId: string) => Promise<RemoteProject[]>;
  readonly native: boolean;
  readDirectory: (connectionId: string, path: string) => Promise<RemoteDirectoryEntry[]>;
  startThread: (connectionId: string, cwd?: string) => Promise<string>;
  readonly threadDetails: ThreadDetailDatabase | null;
};
/** Active project reads and empty-thread changes retain their existing scoped resources. */
export function useActiveProjectSelection(
  remote: ActiveProjectCapability,
  activeConnectionId: string,
  activeRemoteThreadId: string | null,
  activeStoredThread: StoredThreadSummary | null,
  newChatDraft: NewThreadDraft | null,
  changeDraftProject: (draftId: string, cwd: string | null) => void,
  setActiveThreadId: SelectWorkspaceThread,
) {
  const projectCatalog = useRemoteProjectCatalog(
    remote.native,
    remote.connections.filter((connection) => connection.id === activeConnectionId),
    remote.listProjects,
  );

  const { errorsByConnection: projectErrorsByConnection, projectsByConnection } = projectCatalog;

  const workspaceSupportResource = useAsyncResource<WorkspaceSupport | null>(
    remote.native && newChatDraft?.cwd !== null && newChatDraft?.cwd !== undefined
      ? `new-chat-workspace-support:${newChatDraft.connectionId}:${newChatDraft.cwd}`
      : null,
    `${newChatDraft?.connectionId ?? "none"}:${newChatDraft?.cwd ?? "none"}`,
    async () =>
      newChatDraft?.cwd === null || newChatDraft?.cwd === undefined
        ? null
        : remote.inspectWorkspace(newChatDraft.connectionId, newChatDraft.cwd),
  );

  const activeWorkspaceSupport =
    workspaceSupportResource.status === "ready" ? workspaceSupportResource.value : null;

  const activeProjects: RemoteProject[] =
    activeConnectionId === "" || !remote.native
      ? []
      : (projectsByConnection[activeConnectionId] ?? []).filter(({ pinned }) => pinned);

  const activeDiscoveredProjects: RemoteProject[] =
    activeConnectionId === "" || !remote.native
      ? []
      : (projectsByConnection[activeConnectionId] ?? []).filter(({ pinned }) => !pinned);

  const activeProjectError =
    activeConnectionId === "" ? null : (projectErrorsByConnection[activeConnectionId] ?? null);

  const changeEmptyThreadProject = useEvent(async (cwd: string | null): Promise<void> => {
    if (newChatDraft !== null) {
      changeDraftProject(newChatDraft.id, cwd);
      return;
    }
    if (!remote.native || activeConnectionId === "" || activeRemoteThreadId === null) {
      return;
    }
    if (
      (remote.threadDetails?.getThread(activeConnectionId, activeRemoteThreadId)?.turns.length ??
        0) > 0 ||
      (remote.threadDetails?.listQueued(activeConnectionId, activeRemoteThreadId).length ?? 0) > 0
    ) {
      throw new Error("Project can only be changed before the first message");
    }
    const activeCwd = activeStoredThread?.cwd;
    if ((cwd ?? null) === (activeCwd === undefined || activeCwd === "" ? null : activeCwd)) {
      return;
    }
    const previousThreadId = activeRemoteThreadId;
    const nextThreadId = await remote.startThread(activeConnectionId, cwd ?? undefined);
    setActiveThreadId(threadSelectionKey({ id: nextThreadId, serverId: activeConnectionId }));
    await remote.deleteThread(activeConnectionId, previousThreadId);
  });

  const addActiveProject = useEvent(async (path: string): Promise<RemoteProject> => {
    if (!remote.native || activeConnectionId === "") {
      throw new Error("No server selected");
    }
    const project = await remote.addProject(activeConnectionId, path);
    projectCatalog.mergeProject(activeConnectionId, project);
    return project;
  });

  const readActiveDirectory = useEvent(async (path: string): Promise<RemoteDirectoryEntry[]> => {
    if (!remote.native || activeConnectionId === "") {
      throw new Error("No server selected");
    }
    return remote.readDirectory(activeConnectionId, path);
  });
  return {
    activeDiscoveredProjects,
    activeProjectError,
    activeProjects,
    activeWorkspaceSupport,
    addActiveProject,
    changeEmptyThreadProject,
    readActiveDirectory,
  };
}
