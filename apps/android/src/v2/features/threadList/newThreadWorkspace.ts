import type { V2CommandTerminalFrame } from "@codewide/sync-client/v2";

import type { V2Runtime } from "../../application/v2Runtime";
import type { SavedServerId } from "../../domain/ids";
import type { WorkspaceModeSelection } from "./NewThreadWorkspaceMode";

interface PrepareSubmissionWorkspaceInput {
  mode: WorkspaceModeSelection;
  runtime: V2Runtime;
  savedServerId: SavedServerId;
  workspace: string | null;
}

export type PreparedSubmissionWorkspace =
  | { kind: "ready"; workspace: string | null }
  | { kind: "error"; message: string };

interface WorkspacePathParts {
  name: string;
  parentPath: string;
}

export async function prepareSubmissionWorkspace(
  input: PrepareSubmissionWorkspaceInput,
): Promise<PreparedSubmissionWorkspace> {
  const { mode, runtime, savedServerId, workspace } = input;
  if (mode.kind === "current") return { kind: "ready", workspace };
  if (workspace === null) {
    return { kind: "error", message: "Select a project before creating a workspace." };
  }
  const path = splitWorkspacePath(workspace);
  if (path === null) {
    return { kind: "error", message: "The selected project path is invalid." };
  }
  try {
    const frame = await runtime.commandActivations.execute(savedServerId, {
      kind: "workspace.create",
      name: path.name,
      parentPath: path.parentPath,
      provider: mode.support.provider,
    });
    if (frame.type !== "commandCompleted") {
      return { kind: "error", message: frame.error.message };
    }
    if (frame.result.kind !== "workspace.create") {
      return { kind: "error", message: "The server returned an invalid workspace result." };
    }
    return { kind: "ready", workspace: frame.result.path };
  } catch {
    return { kind: "error", message: "Could not create the isolated workspace." };
  }
}

export function completedThreadId(frame: V2CommandTerminalFrame): string | null {
  return frame.type === "commandCompleted" && frame.result.kind === "turn.submit"
    ? frame.result.threadId
    : null;
}

export function newThreadTerminalMessage(frame: V2CommandTerminalFrame): string {
  if (frame.type === "commandIndeterminate") {
    return "The saved action outcome is unknown. Change the draft before trying again.";
  }
  if (frame.type === "commandExpired") {
    return "The saved action expired. Change the draft before trying again.";
  }
  if (frame.type === "commandFailed") {
    return "The server rejected the saved action. Change the draft before trying again.";
  }
  return "The saved action completed without creating a thread. Change the draft before trying again.";
}

function splitWorkspacePath(workspace: string): WorkspacePathParts | null {
  const normalized = workspace.replace(/[\\/]+$/u, "");
  const separator = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (separator < 0 || separator === normalized.length - 1) return null;
  const name = normalized.slice(separator + 1);
  let parentPath = normalized.slice(0, separator);
  if (parentPath === "") parentPath = normalized[separator] ?? "/";
  if (/^[A-Za-z]:$/u.test(parentPath) && normalized[separator] === "\\") parentPath += "\\";
  return { name, parentPath };
}
