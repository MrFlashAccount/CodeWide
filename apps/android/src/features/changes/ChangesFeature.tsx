import { useEvent } from "../../react/useEvent";
import type { DocumentPreviewRequest } from "../../rendering/DocumentPreviewHost";
import type { TurnChangedFile } from "../../rendering/turn-changes";
import type { TurnChangesTarget } from "../../rendering/TurnChangesContext";
import { useConversationRouteNavigation } from "../conversation/conversationRouteNavigation";
import type { ChangePresentationCapabilities } from "./changeCapabilities";
import { codeReviewFilesForDocument } from "../review/resources/reviewFiles";

/** Maps change and document activations to Router-owned destinations. */
export function useChangesFeature(capabilities: ChangePresentationCapabilities) {
  const navigation = useConversationRouteNavigation();
  const openChangesResource = useEvent(() => {
    const presentation = capabilities.currentChangePresentation();
    navigation.openChanges({
      attachCodeReview: capabilities.attachCodeReview,
      cwd: capabilities.cwd,
      getTransferAccess: capabilities.getStableTransferAccess,
      initialResource: presentation.resource,
      kind: "current",
      preferences: capabilities.changesPreferences,
      setPreferences: capabilities.setChangesPreferences,
      thread: capabilities.remoteThread ?? null,
      voiceRuntime: capabilities.appVoiceInputRuntime,
      ...(capabilities.onLoadThreadResources === undefined
        ? {}
        : { loadResources: capabilities.onLoadThreadResources }),
      ...(capabilities.onLoadThreadChangeDiff === undefined
        ? {}
        : { loadDiff: capabilities.onLoadThreadChangeDiff }),
    });
  });
  const presentTurnChanges = useEvent(
    (target: TurnChangesTarget, knownFiles: readonly TurnChangedFile[]) => {
      navigation.openTurnChanges({
        attachCodeReview: capabilities.attachCodeReview,
        cwd: capabilities.cwd,
        getTransferAccess: capabilities.getStableTransferAccess,
        kind: "turn",
        knownFiles,
        target,
        thread: capabilities.remoteThread ?? null,
        voiceRuntime: capabilities.appVoiceInputRuntime,
        wrapLines: capabilities.changesPreferences.wrapLines,
        ...(capabilities.onLoadTurnChanges === undefined
          ? {}
          : { loadTurnChanges: capabilities.onLoadTurnChanges }),
      });
    },
  );
  const openCodeDocument = useEvent((request: DocumentPreviewRequest) => {
    const resource = capabilities.currentThreadResources()?.value ?? null;
    navigation.openCodeDocument({
      attachCodeReview: capabilities.attachCodeReview,
      changeScope: resource?.changeScope,
      cwd: capabilities.cwd,
      document: request,
      files: codeReviewFilesForDocument(resource?.changes ?? [], request.path),
      getTransferAccess: capabilities.getStableTransferAccess,
      kind: "codeDocument",
      thread: capabilities.remoteThread ?? null,
      voiceRuntime: capabilities.appVoiceInputRuntime,
      ...(capabilities.onLoadThreadChangeDiff === undefined
        ? {}
        : { loadDiff: capabilities.onLoadThreadChangeDiff }),
    });
  });
  return { openChangesResource, openCodeDocument, presentTurnChanges };
}
