import type { VoiceInputController } from "../../../data/voice-input-controller";
import { createTextUpload, type SelectedUpload } from "../../../native/file-transfer";
import type { LargePasteEvent } from "../../../native/large-paste";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import {
  useConversationCleanup,
  useConversationRef,
  useConversationState,
} from "../../../ui/use-conversation-scope";
import type { useComposerDraftCommands, useComposerDraftState } from "../draft";
import type { useAttachmentAdmission } from "./attachmentAdmission";
import { captureClipboardLargePaste, type ClipboardLargePasteCapture } from "./largePasteCapture";

export function useLargePasteState(composerScope: string) {
  const [pastedAttachmentPending, setPastedAttachmentPending] = useConversationState(
    composerScope,
    () => false,
  );

  const pastedAttachmentPendingRef = useConversationRef(composerScope, () => false);

  const largePasteOperationRef = useConversationRef<{
    capture: ClipboardLargePasteCapture;
    connectionId: string | null;
    scope: string;
    threadId: string | null;
  } | null>(composerScope, () => null);
  return {
    largePasteOperationRef,
    pastedAttachmentPending,
    pastedAttachmentPendingRef,
    setPastedAttachmentPending,
  };
}

import type { Dispatch, SetStateAction } from "react";
type LargePasteCapabilities = Pick<
  ReturnType<typeof useComposerDraftState>,
  "latestDraftRef" | "draftSelectionRef"
> & {
  captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
  captureStageAttachment: ReturnType<typeof useAttachmentAdmission>["captureStageAttachment"];
  composerScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  largePasteOperationRef: ReturnType<typeof useLargePasteState>["largePasteOperationRef"];
  pastedAttachmentPendingRef: { current: boolean };
  setPastedAttachmentPending: Dispatch<SetStateAction<boolean>>;
  voiceController: VoiceInputController | null;
};
export function useLargePasteActions({
  captureDraftMutations,
  captureStageAttachment,
  composerScope,
  draftConnectionId,
  draftSelectionRef,
  draftThreadId,
  largePasteOperationRef,
  latestDraftRef,
  pastedAttachmentPendingRef,
  setPastedAttachmentPending,
  voiceController,
}: LargePasteCapabilities) {
  const dialog = useAppDialog();

  const clearLargePasteOperation = (
    operation: NonNullable<typeof largePasteOperationRef.current>,
  ) => {
    if (largePasteOperationRef.current !== operation) {
      return;
    }
    largePasteOperationRef.current = null;
    pastedAttachmentPendingRef.current = false;
    setPastedAttachmentPending(false);
  };

  const flushLargePasteCapture = (
    operation: NonNullable<typeof largePasteOperationRef.current>,
  ) => {
    const { updateDraft } = captureDraftMutations();
    if (largePasteOperationRef.current !== operation || operation.scope !== composerScope) {
      return;
    }
    const projection = operation.capture;

    let selected: SelectedUpload;
    try {
      selected = createTextUpload(
        `pasted-snippet-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.txt`,
        "text/plain",
        projection.attachmentText,
      );
    } catch (error) {
      clearLargePasteOperation(operation);
      dialog.alert(
        "Could not attach pasted text",
        error instanceof Error ? error.message : "Could not create the text attachment",
      );
      return;
    }

    const stageAttachment = captureStageAttachment();
    if (stageAttachment(selected)) {
      updateDraft(projection.draftText);
      draftSelectionRef.current = {
        end: projection.insertionOffset,
        start: projection.insertionOffset,
      };
      voiceController?.setPendingSelection(composerScope, draftSelectionRef.current);
    } else {
      updateDraft(projection.pastedDraftText);
    }
    clearLargePasteOperation(operation);
  };

  const handleComposerLargePaste = useEvent((event: LargePasteEvent) => {
    if (largePasteOperationRef.current?.scope === composerScope) {
      return;
    }
    const capture = captureClipboardLargePaste(latestDraftRef.current.latest, event.text, {
      end: event.end,
      start: event.start,
    });
    if (capture === null) {
      return;
    }
    const operation = {
      capture,
      connectionId: draftConnectionId,
      scope: composerScope,
      threadId: draftThreadId,
    };
    largePasteOperationRef.current = operation;
    pastedAttachmentPendingRef.current = true;
    setPastedAttachmentPending(true);
    flushLargePasteCapture(operation);
  });
  useConversationCleanup(composerScope, () => {
    const operation = largePasteOperationRef.current;
    if (operation?.scope === composerScope) {
      clearLargePasteOperation(operation);
    }
  });
  return { handleComposerLargePaste };
}
