import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { GetTransferAccess } from "../../data/private-transfer";
import type {
  ThreadChangeDiffValue,
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/thread-resource-types";
import type { CodeReviewComment } from "../review/comments/reviewComment";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { ChangesPreferences, useChangeResourcePresentation } from "./changePresentation";

/** Presentation intents receive only the selected resource and admitted review capability. */
export type ChangePresentationCapabilities = ReturnType<typeof useChangeResourcePresentation> & {
  appVoiceInputRuntime: AppVoiceInputRuntime;
  attachCodeReview: (comments: readonly CodeReviewComment[]) => Promise<boolean>;
  changesPreferences: ChangesPreferences;
  cwd: string;
  getStableTransferAccess: GetTransferAccess;
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
  remoteThread: Thread | null | undefined;
  setChangesPreferences: (next: ChangesPreferences) => void;
};
