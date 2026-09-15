import type { ThreadResourceLoadKind } from "../../data/thread-resource-response";
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
/** Qualified changes operations; transport and persisted state stay with their existing lower owners. */
export type ChangesWorkspaceCapabilities = {
  loadThreadResources(
    connectionId: string,
    threadId: string,
    scope?: ThreadChangeScope,
    kind?: ThreadResourceLoadKind,
  ): Promise<ThreadResourcesValue>;
  loadThreadChangeDiff(
    connectionId: string,
    threadId: string,
    path: string,
    scope?: ThreadChangeScope,
  ): Promise<ThreadChangeDiffValue>;
};
