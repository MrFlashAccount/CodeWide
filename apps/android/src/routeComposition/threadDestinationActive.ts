import { createContext } from "react";

/**
 * Whether the thread route that owns this subtree is the Threads frame's active destination. The
 * thread layout publishes its own focus, so a sheet or tool route pushed inside the thread keeps
 * it active while a newer thread or the other tab does not. Absent a thread layout it is inactive.
 */
export const ThreadDestinationActiveContext = createContext(false);
