/** Qualified agents operations; transport and persisted state stay with their existing lower owners. */
export type AgentsWorkspaceCapabilities = {
  refreshSubagents(connectionId: string, rootThreadId: string, force?: boolean): Promise<void>;
};
