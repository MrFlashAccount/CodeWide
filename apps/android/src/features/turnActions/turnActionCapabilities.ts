/** Existing thread commands available to a catalog row. */
export type ThreadListMutations = {
  archiveThread: (connectionId: string, threadId: string) => Promise<void>;
  markThreadRead: (connectionId: string, threadId: string) => Promise<void>;
  markThreadUnread: (connectionId: string, threadId: string) => Promise<void>;
  setThreadPinned: (connectionId: string, threadId: string, pinned: boolean) => Promise<void>;
  unarchiveThread: (connectionId: string, threadId: string) => Promise<void>;
};

import type { ThreadForkOptions } from "../../data/thread-fork";
/** Qualified thread mutations retain the existing lower command admission. */
export type ActiveThreadMutations = {
  forkThread: (
    connectionId: string,
    threadId: string,
    options: ThreadForkOptions,
  ) => Promise<string>;
  markThreadRead: (connectionId: string, threadId: string) => Promise<void>;
  native: boolean;
};

/** Shared mutation authority for header and catalog actions. */
export type ThreadMutations = Omit<ThreadListMutations, "markThreadRead" | "markThreadUnread"> & {
  deleteThread: (connectionId: string, threadId: string) => Promise<void>;
  renameThread: (connectionId: string, threadId: string, name: string) => Promise<void>;
};
