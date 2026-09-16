import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
/** Qualified terminal operations; transport and persisted state stay with their existing lower owners. */
export type TerminalWorkspaceCapabilities = {
  listBackgroundTerminals: (
    connectionId: string,
    threadId: string,
  ) => Promise<BackgroundTerminalValue[]>;
  terminateBackgroundTerminal: (
    connectionId: string,
    threadId: string,
    processId: string,
  ) => Promise<boolean>;
};
