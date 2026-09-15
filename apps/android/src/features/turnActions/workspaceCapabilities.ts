import type { ThreadForkOptions } from "../../data/thread-fork";
/** Qualified turnActions operations; transport and persisted state stay with their existing lower owners. */
export type TurnActionsWorkspaceCapabilities = {
  setThreadPinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  renameThread(connectionId: string, threadId: string, name: string): Promise<void>;
  archiveThread(connectionId: string, threadId: string): Promise<void>;
  unarchiveThread(connectionId: string, threadId: string): Promise<void>;
  deleteThread(connectionId: string, threadId: string): Promise<void>;
  markThreadRead(connectionId: string, threadId: string): Promise<void>;
  interruptTurn(connectionId: string, threadId: string, turnId: string): Promise<void>;
  forkThread(connectionId: string, threadId: string, options: ThreadForkOptions): Promise<string>;
  compactThread(connectionId: string, threadId: string): Promise<void>;
};
