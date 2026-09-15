import {
  imageAnnotationAttachment,
  isQuickdrawDraftAttachment,
} from "../../data/quickdraw-attachment";
import { annotatedImageName } from "../../data/quickdraw-image";
import { loadQuickdrawImageSnapshot } from "../../data/quickdraw-image-source";
import type { StoredDraftAttachment } from "../../data/thread-ui-state-types";
import { useEvent } from "../../react/useEvent";
import type { ImagePreviewItem } from "../../rendering/ImagePreviewHost";
import type { AppFullscreenOverlayController } from "../../ui/AppFullscreenOverlay";
import { DrawingWorkspace } from "./DrawingWorkspace";
import { commitDrawing, type DrawingAdmission } from "./drawingAttachment";

type DrawingCapabilities = Omit<DrawingAdmission, "stageAttachment"> & {
  captureStageAttachment(): DrawingAdmission["stageAttachment"];
  composerScope: string;
  fileAttachmentEnabled: boolean;
  readDrawingAttachments(attachmentId: string | undefined): readonly StoredDraftAttachment[];
  hideComposerTray(): void;
  fullscreenOverlay: Pick<AppFullscreenOverlayController, "present">;
};

/** A drawing session retains the opening composer's admission until accepted or closed. */
export function useDrawingFeature(capabilities: DrawingCapabilities) {
  const {
    composerScope,
    fileAttachmentEnabled,
    readDrawingAttachments,
    hideComposerTray,
    fullscreenOverlay,
  } = capabilities;

  const presentDrawing = (
    admission: DrawingAdmission,
    {
      attachment,
      initialSnapshot,
      mode,
      name = null,
      onAttached,
    }: {
      attachment: StoredDraftAttachment | null;
      initialSnapshot: Record<string, unknown> | null;
      mode: "drawing" | "image-annotation";
      name?: string | null;
      onAttached?(): void;
    },
  ) => {
    fullscreenOverlay.present(({ close }) => (
      <DrawingWorkspace
        editing={attachment !== null}
        initialSnapshot={initialSnapshot}
        mode={mode}
        onCommit={async (value) => {
          const committed = await commitDrawing(admission, attachment, mode, name, value);
          if (committed) onAttached?.();
          return committed;
        }}
        onClose={close}
      />
    ));
  };
  const openDrawing = useEvent(() => {
    if (!fileAttachmentEnabled) return;
    hideComposerTray();
    const admission = {
      available: capabilities.available,
      draftThreadId: capabilities.draftThreadId,
      stageAttachment: capabilities.captureStageAttachment(),
    };
    presentDrawing(admission, { attachment: null, initialSnapshot: null, mode: "drawing" });
  });
  const annotateImage = useEvent(
    async (item: ImagePreviewItem, onAttached: () => void): Promise<void> => {
      const admission = {
        available: capabilities.available,
        draftThreadId: capabilities.draftThreadId,
        stageAttachment: capabilities.captureStageAttachment(),
      };
      const attachment =
        item.draft === undefined
          ? null
          : imageAnnotationAttachment(
              item.draft,
              composerScope,
              readDrawingAttachments(item.draft.attachmentId),
            );
      if (
        !admission.available ||
        admission.draftThreadId === null ||
        (attachment === null && !fileAttachmentEnabled)
      )
        throw new Error("File attachments are unavailable");
      const editor =
        attachment !== null && isQuickdrawDraftAttachment(attachment) ? attachment.editor : null;
      const snapshot = editor?.snapshot ?? (await loadQuickdrawImageSnapshot(item.source));
      presentDrawing(admission, {
        attachment,
        initialSnapshot: snapshot,
        mode: editor?.mode ?? "image-annotation",
        name: editor === null ? annotatedImageName(item.label) : (attachment?.name ?? null),
        onAttached,
      });
    },
  );
  return { openDrawing, annotateImage };
}
