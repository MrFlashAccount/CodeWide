import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { GetTransferAccess } from "../../data/private-transfer";
import type {
  ThreadChangeDiffValue,
  ThreadChangeScope,
  ThreadResourcesValue,
} from "../../data/thread-resource-types";
import type { CodeReviewComment } from "../../rendering/code-review";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import type { AppFullscreenOverlayController } from "../../ui/AppFullscreenOverlay";
import type { AppVoiceInputRuntime } from "../../ui/VoiceInputRuntime";
import type { ChangesPreferences, useChangeResourcePresentation } from "./changePresentation";

/** Presentation intents receive only the selected resource and admitted review capability. */
export type ChangePresentationCapabilities = ReturnType<typeof useChangeResourcePresentation> & {
  cwd: string;
  remoteThread: Thread | null | undefined;
  changesPreferences: ChangesPreferences;
  setChangesPreferences(next: ChangesPreferences): void;
  dismissComposerKeyboardForOverlay(): void;
  fullscreenOverlay: Pick<AppFullscreenOverlayController, "present">;
  appVoiceInputRuntime: AppVoiceInputRuntime;
  getStableTransferAccess: GetTransferAccess;
  attachCodeReview(comments: readonly CodeReviewComment[]): Promise<boolean>;
  onLoadTurnChanges:
    | ((target: TurnChangesTarget) => Promise<readonly TurnChangedFile[]>)
    | undefined;
  onLoadThreadResources:
    | ((
        scope?: ThreadChangeScope,
        kind?: "all" | "changes" | "attachments",
      ) => Promise<ThreadResourcesValue>)
    | undefined;
  onLoadThreadChangeDiff:
    | ((path: string, scope?: ThreadChangeScope) => Promise<ThreadChangeDiffValue>)
    | undefined;
};
