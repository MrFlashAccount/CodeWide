import type {
  FsReadDirectoryResponse,
  ThreadStartResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";
import { seedThreadExecutionSettings } from "@codewide/sync-client";
import {
  parseAddedRemoteProject,
  parseProjectHome,
  parseRemoteDirectory,
  parseRemoteProjects,
  type RemoteDirectoryEntry,
  type RemoteProject,
} from "../../data/remote-projects";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import {
  parseCreatedWorkspace,
  parseWorkspaceSupport,
  startThreadInCreatedWorkspace,
  type CreatedWorkspace,
  type WorkspaceSupport,
} from "../../data/workspace-creation";
import type { TurnControlsValue } from "../../data/workspace-resource-database";
import type { WorkspaceSyncSession, createWorkspaceSession } from "../../data/workspace-session";

import type { ProjectsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts projects intents using retained lower authorities. */
export function createProjectsWorkspaceAdapter({
  getDetails,
  getSession,
  getSummaries,
  loadTurnControls,
  rpcAfterAttach,
}: {
  getDetails: () => Pick<ThreadDetailDatabase, "importThreadSnapshot"> | null;
  getSession: (connectionId: string) => WorkspaceSyncSession | undefined;
  getSummaries: () => Pick<ThreadSummaryDatabase, "insertStartedThread"> | null;
  loadTurnControls: (connectionId: string, cwd: string) => Promise<TurnControlsValue>;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): ProjectsWorkspaceCapabilities {
  const listProjects = async (connectionId: string): Promise<RemoteProject[]> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return parseRemoteProjects(await rpcAfterAttach(session, "companion/project/list", {}));
  };

  const addProject = async (connectionId: string, path: string): Promise<RemoteProject> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return parseAddedRemoteProject(
      await rpcAfterAttach(session, "companion/project/add", { path }),
    );
  };

  const setProjectPinned = async (
    connectionId: string,
    path: string,
    name: string,
    pinned: boolean,
  ): Promise<RemoteProject> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return parseAddedRemoteProject(
      await rpcAfterAttach(session, "companion/project/add", { name, path, pinned }),
    );
  };

  const readDirectory = async (
    connectionId: string,
    path: string,
  ): Promise<RemoteDirectoryEntry[]> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<FsReadDirectoryResponse>(session, "fs/readDirectory", {
      path,
    });
    return parseRemoteDirectory(response);
  };

  const readProjectHome = async (connectionId: string): Promise<string> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return parseProjectHome(await rpcAfterAttach(session, "companion/project/home", {}));
  };

  const inspectWorkspace = async (
    connectionId: string,
    workspace: string,
  ): Promise<WorkspaceSupport | null> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return parseWorkspaceSupport(
      await rpcAfterAttach(session, "companion/workspace/inspect", { workspace }),
    );
  };

  const createWorkspace = async (
    connectionId: string,
    workspace: string,
    requestId: string,
  ): Promise<CreatedWorkspace> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    return parseCreatedWorkspace(
      await rpcAfterAttach(session, "companion/workspace/create", { requestId, workspace }),
    );
  };

  const startThreadInWorkspace = async (
    connectionId: string,
    workspace: string,
    requestId: string,
  ): Promise<string> => {
    const started = await startThreadInCreatedWorkspace({
      createWorkspace: async () => createWorkspace(connectionId, workspace, requestId),
      startThread: async (cwd) => startThread(connectionId, cwd),
    });
    return started.threadId;
  };

  const startThread = async (connectionId: string, cwd?: string): Promise<string> => {
    const session = getSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const response = await rpcAfterAttach<ThreadStartResponse>(
      session,
      "thread/start",
      cwd === undefined ? {} : { cwd },
    );
    // thread/start already returns the authoritative execution settings.
    // Preserve them on the empty shell so a new conversation can paint its
    // model and permission chips before the first turn exists.
    const started = seedThreadExecutionSettings(response.thread, {
      approvalPolicy:
        typeof response.approvalPolicy === "string" ? response.approvalPolicy : "granular",
      effort: response.reasoningEffort,
      model: response.model,
      permissions: response.activePermissionProfile?.id ?? null,
      sandboxPolicy: response.sandbox.type,
    });
    await getDetails()?.importThreadSnapshot(connectionId, started, "initial");
    await getSummaries()?.insertStartedThread(connectionId, started);
    // Catalogs are scoped by server + cwd, not by turn. Warm them as soon as
    // the shell exists instead of waiting for thread/resume after a message.
    void loadTurnControls(connectionId, started.cwd).catch(() => undefined);
    return started.id;
  };
  return {
    addProject,
    createWorkspace,
    inspectWorkspace,
    listProjects,
    readDirectory,
    readProjectHome,
    setProjectPinned,
    startThread,
    startThreadInWorkspace,
  };
}
