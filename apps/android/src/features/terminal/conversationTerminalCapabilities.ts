import type { TerminalWorkspaceCapabilities } from "./workspaceCapabilities";
import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
/** Qualified capabilities consumed by the terminal owner in conversation composition. */
export type ConversationTerminalCapabilities = {
  backgroundTerminalsResourceId: string | null;
  onListTerminals: (() => Promise<BackgroundTerminalValue[]>) | undefined;
  onTerminateTerminal: ((processId: string) => Promise<boolean>) | undefined;
  /** Reads the captured thread's completed command, if it has reached history. */
  readTerminalCommand: TerminalWorkspaceCapabilities["readTerminalCommand"];
};
