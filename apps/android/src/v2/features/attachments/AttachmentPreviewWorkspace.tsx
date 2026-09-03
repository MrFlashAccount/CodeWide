import type { V2Attachment } from "@codewide/sync-client/v2";
import { useState } from "react";

import { useEvent } from "../../../react/useEvent";
import type { QuickdrawImageSource } from "../../application/drawing/quickdrawImageSource";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import {
  V2RenderingCapabilityProvider,
  type RenderingImageItem,
  type V2RenderingCapabilities,
} from "../../rendering/renderingCapabilities";
import { createAttachmentAnnotationCapability } from "../drawing/attachmentAnnotation";
import { DrawingWorkspace, type DrawingWorkspaceRequest } from "../drawing/DrawingWorkspace";
import { AttachmentPreviewScreen } from "./AttachmentPreviewScreen";
import { attachmentForImageItem } from "./attachmentReference";
import {
  createAttachmentRenderingCapabilities,
  type AttachmentPreviewDestination,
} from "./createAttachmentRenderingCapabilities";
import type { AttachmentRendererCapabilities } from "./previewCapabilities";

interface AttachmentPreviewWorkspaceProps extends AttachmentRendererCapabilities {
  attachments: V2Attachment[];
  imageSource: QuickdrawImageSource;
  initialAttachmentId: string;
  navigate(destination: AttachmentPreviewDestination): void;
  openExternalLink(url: string): void | Promise<void>;
  openWorkspaceFile(path: string): void;
  owner: QualifiedThread;
  workspace: string;
}

/** Owns the preview-to-QuickDraw transition and the thread's shared composer draft. */
export function AttachmentPreviewWorkspace(
  props: AttachmentPreviewWorkspaceProps,
): React.JSX.Element {
  const {
    attachments,
    imageSource,
    initialAttachmentId,
    navigate,
    openExternalLink,
    openWorkspaceFile,
    owner,
    Player,
    WebPreview,
    workspace,
  } = props;
  const runtime = useV2Runtime();
  const [drawingRequest, setDrawingRequest] = useState<DrawingWorkspaceRequest | null>(null);
  const now = useEvent(() => new Date(runtime.now()));
  const present = useEvent((request: DrawingWorkspaceRequest): void => setDrawingRequest(request));
  const [annotate] = useState(() =>
    createAttachmentAnnotationCapability({ imageSource, now, present }),
  );
  const attachmentCapabilities = createAttachmentRenderingCapabilities({
    annotate,
    attachments,
    navigate,
    openWorkspaceFile,
    owner,
    preview(savedServerId, sourceUrl, mode) {
      return runtime.preview(savedServerId, sourceUrl, mode);
    },
  });
  const renderingCapabilities = attachmentPreviewRenderingCapabilities(
    attachmentCapabilities,
    attachments,
    openExternalLink,
  );
  const closeDrawing = useEvent((): void => setDrawingRequest(null));
  const finishDrawing = useEvent((_draftItemId: string): void => setDrawingRequest(null));
  const draft = runtime.composerAttachments.draft({
    draftId: `thread:${owner.threadId}`,
    savedServerId: owner.savedServerId,
    target: { threadId: owner.threadId, workspace },
  });
  if (drawingRequest !== null) {
    return (
      <DrawingWorkspace
        draft={draft}
        draftItemId={drawingRequest.draftItemId}
        initialSnapshot={drawingRequest.initialSnapshot}
        mode={drawingRequest.mode}
        {...(drawingRequest.name === undefined ? {} : { name: drawingRequest.name })}
        now={now}
        onAttached={finishDrawing}
        onClose={closeDrawing}
      />
    );
  }
  return (
    <V2RenderingCapabilityProvider capabilities={renderingCapabilities}>
      <AttachmentPreviewScreen
        annotate={annotate}
        attachments={attachments}
        initialAttachmentId={initialAttachmentId}
        owner={owner}
        Player={Player}
        WebPreview={WebPreview}
      />
    </V2RenderingCapabilityProvider>
  );
}

function attachmentPreviewRenderingCapabilities(
  capabilities: ReturnType<typeof createAttachmentRenderingCapabilities>,
  attachments: readonly V2Attachment[],
  openExternalLink: (url: string) => void | Promise<void>,
): V2RenderingCapabilities {
  const canAnnotateImage = (item: RenderingImageItem): boolean =>
    attachmentForImageItem(attachments, item) !== null;
  const canOpenLocalDocument = capabilities.canOpenLocalDocument;
  const resolveImageSource = (reference: string) =>
    capabilities.resolveImageSource(reference) ?? capabilities.resolvePrivateImageSource(reference);
  return {
    ...(capabilities.annotateImage === undefined
      ? {}
      : { annotateImage: capabilities.annotateImage }),
    canAnnotateImage,
    canOpenLocalDocument,
    imageSourceRevision: capabilities.imageSourceRevision,
    openExternalLink,
    openImagePreview: capabilities.openImagePreview,
    openLocalDocument: capabilities.openLocalDocument,
    resolveImageSource,
  };
}
