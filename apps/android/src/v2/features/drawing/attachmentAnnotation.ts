import type { AttachmentAnnotationCapability } from "../attachments/attachmentAnnotation";
import type { QuickdrawImageSource } from "../../application/drawing/quickdrawImageSource";
import { annotatedImageName } from "../../application/drawing/quickdrawImage";
import type { DrawingWorkspacePresenter } from "./DrawingWorkspace";

interface AttachmentAnnotationInput {
  imageSource: QuickdrawImageSource;
  now(): Date;
  present: DrawingWorkspacePresenter;
}

/** Adapts a securely materialized preview image into a QuickDraw annotation session. */
export function createAttachmentAnnotationCapability(
  input: AttachmentAnnotationInput,
): AttachmentAnnotationCapability {
  return async (request) => {
    const snapshot = await input.imageSource.load(request.source);
    input.present({
      draftItemId: null,
      initialSnapshot: snapshot,
      mode: "image-annotation",
      name: annotatedImageName(request.name, input.now()),
    });
  };
}
