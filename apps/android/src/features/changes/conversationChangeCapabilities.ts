import type { ThreadChangeDiffValue } from "../../data/thread-resource-types";
import type { ThreadResourcesModel } from "../../data/thread-resources-model";
import type {
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/workspace-resource-database";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
/** Qualified capabilities consumed by the changes owner in conversation composition. */
export type ConversationChangeCapabilities = {
  onLoadThreadChangeDiff:
    | ((path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>)
    | undefined;
  onLoadThreadResources:
    | ((
        scope?: ThreadChangeScope,
        kind?: "all" | "changes" | "attachments",
      ) => Promise<ThreadResourcesValue>)
    | undefined;
  onLoadTurnChanges:
    | ((target: TurnChangesTarget) => Promise<readonly TurnChangedFile[]>)
    | undefined;
  threadResourceId: string | null;
  threadResourceRevision: string;
  threadResourcesModel: ThreadResourcesModel | null;
};
