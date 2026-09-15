/** Existing thread commands available to a catalog row. */
export type ThreadListMutations = {
  setThreadPinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  archiveThread(connectionId: string, threadId: string): Promise<void>;
  unarchiveThread(connectionId: string, threadId: string): Promise<void>;
  markThreadRead(connectionId: string, threadId: string): Promise<void>;
};

import type { ThreadForkOptions } from "../../data/thread-fork";
/** Qualified thread mutations retain the existing lower command admission. */
export type ActiveThreadMutations = {
  native: boolean;
  forkThread(connectionId: string, threadId: string, options: ThreadForkOptions): Promise<string>;
  markThreadRead(connectionId: string, threadId: string): Promise<void>;
};

/** Shared mutation authority for header and catalog actions. */
export type ThreadMutations = Omit<ThreadListMutations, "markThreadRead"> & {
  renameThread(connectionId: string, threadId: string, name: string): Promise<void>;
  deleteThread(connectionId: string, threadId: string): Promise<void>;
};
