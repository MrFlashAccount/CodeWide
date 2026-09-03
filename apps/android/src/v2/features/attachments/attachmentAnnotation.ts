import type { PreviewLocalFile } from "../../application/preview/previewTransport";

interface AttachmentAnnotationRequest {
  attachmentId: string;
  name: string;
  source: PreviewLocalFile;
}

/** The composer owns creation and upload of the annotated draft. The preview
 * owns only secure materialization and hands the local image across this seam. */
export type AttachmentAnnotationCapability = (
  request: AttachmentAnnotationRequest,
) => void | Promise<void>;
