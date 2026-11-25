import type { TerminalCommandSnapshot } from "../../data/terminalOutputEvents";
import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
/** Qualified terminal operations; transport and persisted state stay with their existing lower owners. */
export type TerminalWorkspaceCapabilities = {
  listBackgroundTerminals: (
    connectionId: string,
    threadId: string,
  ) => Promise<BackgroundTerminalValue[]>;
  /** Reads a completed process's canonical command output. */
  readTerminalCommand: (request: {
    readonly connectionId: string;
    readonly itemId: string;
    readonly signal: AbortSignal;
    readonly threadId: string;
  }) => Promise<TerminalCommandSnapshot | null>;
  terminateBackgroundTerminal: (
    connectionId: string,
    threadId: string,
    processId: string,
  ) => Promise<boolean>;
};
