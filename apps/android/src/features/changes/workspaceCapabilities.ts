import type { ThreadResourceLoadKind } from "../../data/thread-resource-response";
import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
/** Qualified changes operations; transport and persisted state stay with their existing lower owners. */
export type ChangesWorkspaceCapabilities = {
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  loadThreadChangeDiff: (
    connectionId: string,
    threadId: string,
    path: string,
    scope?: ThreadChangeScope,
  ) => Promise<ThreadChangeDiffValue>;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  loadThreadResources: (
    connectionId: string,
    threadId: string,
    scope?: ThreadChangeScope,
    kind?: ThreadResourceLoadKind,
  ) => Promise<ThreadResourcesValue>;
};
