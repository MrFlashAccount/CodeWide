export const WORKSPACE_CREATE_CAPABILITY = "workspace.create@1";

export type WorkspaceSupport = {
  capability: typeof WORKSPACE_CREATE_CAPABILITY;
  provider: string;
  displayName: string;
  repositoryRoot: string;
};

export type CreatedWorkspace = {
  capability: typeof WORKSPACE_CREATE_CAPABILITY;
  provider: string;
  repositoryRoot: string;
  cwd: string;
  created: boolean;
};

export type NewChatWorkspaceMode = "current" | "isolated";

export type StartedWorkspaceThread = {
  threadId: string;
  workspace: CreatedWorkspace;
};

/**
 * Owns the application-level handoff from a provider checkout to a Codex
 * session. The provider's effective cwd must become the thread cwd; callers
 * must not keep using the source project's path after checkout.
 */
export async function startThreadInCreatedWorkspace(input: {
  createWorkspace: () => Promise<CreatedWorkspace>;
  startThread: (cwd: string) => Promise<string>;
}): Promise<StartedWorkspaceThread> {
  const workspace = await input.createWorkspace();
  const threadId = await input.startThread(workspace.cwd);
  return { threadId, workspace };
}

export function parseWorkspaceSupport(value: unknown): WorkspaceSupport | null {
  const envelope = record(value);
  if (envelope === null || !("support" in envelope)) {
    throw new Error("Companion returned an invalid workspace capability response");
  }
  if (envelope.support === null) return null;
  const support = record(envelope.support);
  if (
    support === null
    || support.capability !== WORKSPACE_CREATE_CAPABILITY
    || typeof support.provider !== "string"
    || support.provider === ""
    || typeof support.displayName !== "string"
    || support.displayName === ""
    || typeof support.repositoryRoot !== "string"
    || support.repositoryRoot === ""
  ) throw new Error("Companion returned invalid workspace capability metadata");
  return {
    capability: WORKSPACE_CREATE_CAPABILITY,
    provider: support.provider,
    displayName: support.displayName,
    repositoryRoot: support.repositoryRoot,
  };
}

export function parseCreatedWorkspace(value: unknown): CreatedWorkspace {
  const envelope = record(value);
  const workspace = record(envelope?.workspace);
  if (
    workspace === null
    || workspace.capability !== WORKSPACE_CREATE_CAPABILITY
    || typeof workspace.provider !== "string"
    || workspace.provider === ""
    || typeof workspace.repositoryRoot !== "string"
    || workspace.repositoryRoot === ""
    || typeof workspace.cwd !== "string"
    || workspace.cwd === ""
    || typeof workspace.created !== "boolean"
  ) throw new Error("Companion returned an invalid created workspace");
  return {
    capability: WORKSPACE_CREATE_CAPABILITY,
    provider: workspace.provider,
    repositoryRoot: workspace.repositoryRoot,
    cwd: workspace.cwd,
    created: workspace.created,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
