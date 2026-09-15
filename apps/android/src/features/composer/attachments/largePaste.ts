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
import { useComposerDraftCommands, useComposerDraftState } from "../draft";
import { useAttachmentAdmission } from "./attachmentAdmission";
import { captureClipboardLargePaste, type ClipboardLargePasteCapture } from "./largePasteCapture";

export function useLargePasteState(composerScope: string) {
  const [pastedAttachmentPending, setPastedAttachmentPending] = useConversationState(
    composerScope,
    () => false,
  );

  const pastedAttachmentPendingRef = useConversationRef(composerScope, () => false);

  const largePasteOperationRef = useConversationRef<{
    scope: string;
    connectionId: string | null;
    threadId: string | null;
    capture: ClipboardLargePasteCapture;
  } | null>(composerScope, () => null);
  return {
    pastedAttachmentPending,
    setPastedAttachmentPending,
    pastedAttachmentPendingRef,
    largePasteOperationRef,
  };
}

import type { Dispatch, SetStateAction } from "react";
type LargePasteCapabilities = Pick<
  ReturnType<typeof useComposerDraftState>,
  "latestDraftRef" | "draftSelectionRef"
> & {
  composerScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  voiceController: VoiceInputController | null;
  captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
  captureStageAttachment: ReturnType<typeof useAttachmentAdmission>["captureStageAttachment"];
  setPastedAttachmentPending: Dispatch<SetStateAction<boolean>>;
  pastedAttachmentPendingRef: { current: boolean };
  largePasteOperationRef: ReturnType<typeof useLargePasteState>["largePasteOperationRef"];
};
export function useLargePasteActions({
  composerScope,
  draftConnectionId,
  draftThreadId,
  latestDraftRef,
  draftSelectionRef,
  voiceController,
  captureDraftMutations,
  captureStageAttachment,
  setPastedAttachmentPending,
  pastedAttachmentPendingRef,
  largePasteOperationRef,
}: LargePasteCapabilities) {
  const dialog = useAppDialog();

  const clearLargePasteOperation = (
    operation: NonNullable<typeof largePasteOperationRef.current>,
  ) => {
    if (largePasteOperationRef.current !== operation) return;
    largePasteOperationRef.current = null;
    pastedAttachmentPendingRef.current = false;
    setPastedAttachmentPending(false);
  };

  const flushLargePasteCapture = async (
    operation: NonNullable<typeof largePasteOperationRef.current>,
  ) => {
    const { updateDraft } = captureDraftMutations();
    if (largePasteOperationRef.current !== operation || operation.scope !== composerScope) return;
    const projection = operation.capture;

    let selected: SelectedUpload;
    try {
      selected = createTextUpload(
        `pasted-snippet-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`,
        "text/plain",
        projection.attachmentText,
      );
    } catch (cause) {
      clearLargePasteOperation(operation);
      dialog.alert(
        "Could not attach pasted text",
        cause instanceof Error ? cause.message : "Could not create the text attachment",
      );
      return;
    }

    const stageAttachment = captureStageAttachment();
    if (stageAttachment(selected)) {
      updateDraft(projection.draftText);
      draftSelectionRef.current = {
        start: projection.insertionOffset,
        end: projection.insertionOffset,
      };
      voiceController?.setPendingSelection(composerScope, draftSelectionRef.current);
    } else {
      updateDraft(projection.pastedDraftText);
    }
    clearLargePasteOperation(operation);
  };

  const handleComposerLargePaste = useEvent((event: LargePasteEvent) => {
    if (largePasteOperationRef.current?.scope === composerScope) return;
    const capture = captureClipboardLargePaste(latestDraftRef.current.latest, event.text, {
      start: event.start,
      end: event.end,
    });
    if (capture === null) return;
    const operation = {
      scope: composerScope,
      connectionId: draftConnectionId,
      threadId: draftThreadId,
      capture,
    };
    largePasteOperationRef.current = operation;
    pastedAttachmentPendingRef.current = true;
    setPastedAttachmentPending(true);
    void flushLargePasteCapture(operation);
  });
  useConversationCleanup(composerScope, () => {
    const operation = largePasteOperationRef.current;
    if (operation?.scope === composerScope) clearLargePasteOperation(operation);
  });
  return { handleComposerLargePaste };
}
