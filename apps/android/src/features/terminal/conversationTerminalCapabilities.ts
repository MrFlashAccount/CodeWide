import type { BackgroundTerminalValue } from "../../data/workspace-resource-database";
/** Qualified capabilities consumed by the terminal owner in conversation composition. */
export type ConversationTerminalCapabilities = {
  backgroundTerminalsResourceId: string | null;
  onListTerminals: (() => Promise<BackgroundTerminalValue[]>) | undefined;
  onTerminateTerminal: ((processId: string) => Promise<boolean>) | undefined;
};
