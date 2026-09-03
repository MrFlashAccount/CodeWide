import type { V2Attachment } from "@codewide/sync-client/v2";

import type {
  PreviewLocalFile,
  PreviewMode,
  PreviewStreamSource,
} from "../../application/preview/previewTransport";
import type { PreviewValue } from "../../application/resources/previewResource";
import type { ResourceSnapshot } from "../../application/resources/resource";
import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import type {
  RenderingImageItem,
  RenderingImageSource,
} from "../../rendering/renderingCapabilities";
import {
  attachmentPreviewDestination,
  type AttachmentPreviewDestinationParams,
  type RouteDestination,
} from "../navigation/routeDestinations";
import type { AttachmentAnnotationCapability } from "./attachmentAnnotation";
import { isImageAttachment } from "./attachmentPreviewModel";
import { attachmentForImageItem, attachmentForReference } from "./attachmentReference";
import { workspaceFileReference } from "./workspaceFileReference";

export type AttachmentPreviewDestination = RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]",
  AttachmentPreviewDestinationParams
>;

const NOOP = (): void => undefined;

interface AttachmentPreviewResourcePort {
  materialize(name: string, contentType: string): Promise<PreviewLocalFile>;
  snapshot(): ResourceSnapshot<PreviewValue>;
  subscribe(listener: () => void): () => void;
}

export interface CreateAttachmentRenderingCapabilitiesInput {
  annotate?: AttachmentAnnotationCapability;
  attachments: readonly V2Attachment[];
  navigate(destination: AttachmentPreviewDestination): void;
  openWorkspaceFile(path: string): void;
  owner: QualifiedThread;
  preview(
    savedServerId: SavedServerId,
    sourceUrl: string,
    mode: PreviewMode,
  ): AttachmentPreviewResourcePort;
}

export interface AttachmentRenderingCapabilities {
  annotateImage?(item: RenderingImageItem): Promise<void>;
  imageSourceRevision: string;
  canOpenLocalDocument(href: string): boolean;
  openImagePreview(items: RenderingImageItem[], selectedId: string): boolean;
  openLocalDocument(href: string): boolean;
  resolveImageSource(reference: string): RenderingImageSource | null;
  resolvePrivateImageSource(reference: string): Promise<RenderingImageSource | null>;
}

/** Owns every Markdown-to-attachment transition. Private bytes are resolved
 * only through PreviewTransport-backed resources, and every fullscreen open
 * uses the qualified attachment route instead of leaking a source URL. */
export function createAttachmentRenderingCapabilities(
  input: CreateAttachmentRenderingCapabilitiesInput,
): AttachmentRenderingCapabilities {
  const openAttachment = (attachment: V2Attachment): void => {
    input.navigate(
      attachmentPreviewDestination({ attachmentId: attachment.id, owner: input.owner }),
    );
  };
  const openLocalDocument = (href: string): boolean => {
    const attachment = attachmentForReference(input.attachments, href);
    if (attachment !== null) {
      openAttachment(attachment);
      return true;
    }
    const path = workspaceFileReference(href);
    if (path === null) return false;
    input.openWorkspaceFile(path);
    return true;
  };
  const canOpenLocalDocument = (href: string): boolean =>
    attachmentForReference(input.attachments, href) !== null ||
    workspaceFileReference(href) !== null;
  const openImagePreview = (items: RenderingImageItem[], selectedId: string): boolean => {
    const selected = items.find((item) => item.id === selectedId);
    if (selected === undefined) return false;
    const attachment = attachmentForImageItem(input.attachments, selected);
    if (attachment === null) return false;
    openAttachment(attachment);
    return true;
  };
  const resolveImageSource = (reference: string): RenderingImageSource | null => {
    const attachment = attachmentForReference(input.attachments, reference);
    if (attachment === null || !isImageAttachment(attachment)) return null;
    return localRenderingSource(attachment.downloadUrl);
  };
  const resolvePrivateImageSource = async (
    reference: string,
  ): Promise<RenderingImageSource | null> => {
    const attachment = attachmentForReference(input.attachments, reference);
    if (attachment === null || !isImageAttachment(attachment) || attachment.downloadUrl === null) {
      return null;
    }
    const local = localRenderingSource(attachment.downloadUrl);
    if (local !== null) return local;
    const resource = input.preview(input.owner.savedServerId, attachment.downloadUrl, "image");
    return renderingSource(await settledStream(resource));
  };
  const capabilities: AttachmentRenderingCapabilities = {
    canOpenLocalDocument,
    imageSourceRevision: attachmentImageSourceRevision(input.owner, input.attachments),
    openImagePreview,
    openLocalDocument,
    resolveImageSource,
    resolvePrivateImageSource,
  };
  const annotate = input.annotate;
  if (annotate !== undefined) {
    capabilities.annotateImage = async (item): Promise<void> => {
      const attachment = attachmentForImageItem(input.attachments, item);
      const fallbackName = item.alt.trim() === "" ? "image" : item.alt.trim();
      const name = attachment?.name ?? fallbackName;
      const contentType = attachment?.mediaType ?? "application/octet-stream";
      const source = await materializedImage(input, attachment, item, name, contentType);
      await annotate({ attachmentId: attachment?.id ?? item.id, name, source });
    };
  }
  return capabilities;
}

/** Changes whenever a qualified attachment source can resolve to different bytes. */
function attachmentImageSourceRevision(
  owner: QualifiedThread,
  attachments: readonly V2Attachment[],
): string {
  const resources = attachments
    .map(
      (attachment) =>
        `${attachment.id}\u0001${attachment.name}\u0001${attachment.mediaType}\u0001${attachment.downloadUrl ?? ""}`,
    )
    .join("\u0002");
  return `${owner.savedServerId}\u0003${owner.threadId}\u0003${resources}`;
}

async function materializedImage(
  input: CreateAttachmentRenderingCapabilitiesInput,
  attachment: V2Attachment | null,
  item: RenderingImageItem,
  name: string,
  contentType: string,
): Promise<PreviewLocalFile> {
  const sourceUrl = attachment?.downloadUrl ?? item.source.uri;
  if (sourceUrl === null) throw new Error("This image has no private preview source");
  const local = localRenderingSource(sourceUrl);
  if (local !== null) return { contentType, name, uri: local.uri };
  return input
    .preview(input.owner.savedServerId, sourceUrl, "image")
    .materialize(name, contentType);
}

async function settledStream(
  resource: AttachmentPreviewResourcePort,
): Promise<PreviewStreamSource> {
  const initial = resource.snapshot();
  if (initial.status !== "loading") return streamFromSnapshot(initial);
  const settled = await new Promise<ResourceSnapshot<PreviewValue>>((resolve) => {
    let unsubscribe = NOOP;
    const publish = (): void => {
      const snapshot = resource.snapshot();
      if (snapshot.status === "loading") return;
      unsubscribe();
      resolve(snapshot);
    };
    unsubscribe = resource.subscribe(publish);
    publish();
  });
  return streamFromSnapshot(settled);
}

function streamFromSnapshot(snapshot: ResourceSnapshot<PreviewValue>): PreviewStreamSource {
  if (snapshot.status === "error") throw new Error(snapshot.message);
  if (snapshot.value.stream === null) throw new Error("This image has no private preview stream");
  return snapshot.value.stream;
}

function renderingSource(source: PreviewStreamSource): RenderingImageSource {
  return source.headers === null
    ? { uri: source.uri }
    : { headers: source.headers, uri: source.uri };
}

function localRenderingSource(sourceUrl: string | null): RenderingImageSource | null {
  return sourceUrl !== null && (sourceUrl.startsWith("file:") || sourceUrl.startsWith("content:"))
    ? { uri: sourceUrl }
    : null;
}
