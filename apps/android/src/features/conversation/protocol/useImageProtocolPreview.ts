import type { RenderBlock } from "@codewide/renderers";
import { useContext } from "react";

import type { GetTransferAccess, PrivateAssetSource } from "../../../data/private-transfer";
import {
  ArtifactImageReferences,
  artifactImagePreviewOrder,
} from "../../../rendering/ArtifactImageReferences";
import { basename } from "../../../rendering/changed-file-path";
import { privateImageAssetProjection, safeImageUri } from "../../../rendering/image-source";
import {
  useImagePreview,
  useImagePreviewGroup,
  useRegisterImagePreviewItem,
  type ImagePreviewItem,
} from "../../../rendering/ImagePreviewHost";
import { usePrivateAssetUri } from "../../../rendering/use-private-image-uri";
import {
  imageAttachmentPreviewId,
  type UserMessageAttachmentSource,
} from "../../../rendering/user-message-attachments";
import { useEvent } from "../../../react/useEvent";
import { useAppDialog } from "../../../ui/AppDialog";
import { ToolCardPlacementContext } from "../turns/turnContexts";

type ImageProjection =
  | {
      readonly galleryReference: string;
      readonly previewSource: UserMessageAttachmentSource;
      readonly reference: string;
      readonly source: PrivateAssetSource;
      readonly status: "available";
    }
  | { readonly status: "unavailable" };

/** Direct semantic preview action for an image tool row. */
export function useImageProtocolPreview({
  block,
  getTransferAccess,
}: {
  readonly block: RenderBlock;
  readonly getTransferAccess: GetTransferAccess | undefined;
}): { readonly onOpen: () => void; readonly openLabel: string } {
  const dialog = useAppDialog();
  const galleryReferences = useContext(ArtifactImageReferences);
  const placement = useContext(ToolCardPlacementContext);
  const groupId = useImagePreviewGroup();
  const openImagePreview = useImagePreview();
  const projection = projectImage(block);
  const privateImage = usePrivateAssetUri(
    projection.status === "available" ? projection.source : null,
    { access: getTransferAccess },
  );
  const galleryOrder =
    projection.status === "available"
      ? artifactImagePreviewOrder(galleryReferences, projection.galleryReference)
      : undefined;
  const previewItem = createPreviewItem({
    block,
    galleryOrder,
    projection,
    source: privateImage.source ?? immediateImageSource(projection),
  });
  useRegisterImagePreviewItem(
    placement.kind === "sheet" && galleryOrder === undefined && previewItem !== null
      ? groupId
      : null,
    previewItem ?? unavailablePreviewItem(block),
  );
  const onOpen = useEvent(() => {
    if (previewItem === null) {
      dialog.alert(
        "Image preview unavailable",
        privateImage.failed ? "The image could not be loaded." : "The image is still loading.",
      );
      return;
    }
    openImagePreview({ ...previewItem, groupId });
  });
  return { onOpen, openLabel: `Open preview for ${block.title}` };
}

function projectImage(block: RenderBlock): ImageProjection {
  const localPath =
    block.kind === "imageView"
      ? typeof block.raw.path === "string"
        ? block.raw.path
        : null
      : typeof block.raw.savedPath === "string"
        ? block.raw.savedPath
        : null;
  if (localPath !== null) {
    return {
      galleryReference: localPath,
      previewSource: { path: localPath, type: "path" },
      reference: localPath,
      source: { kind: "path", path: localPath },
      status: "available",
    };
  }
  const asset = privateImageAssetProjection(block.raw.codewideAsset);
  if (asset !== null) {
    return {
      galleryReference: `content:${asset.id}`,
      previewSource: { asset, type: "content" },
      reference: `private-asset:${asset.id}`,
      source: { id: asset.id, kind: "content" },
      status: "available",
    };
  }
  const remoteResult = safeImageUri(block.raw.result);
  if (remoteResult === null) {
    return { status: "unavailable" };
  }
  return {
    galleryReference: remoteResult,
    previewSource: { type: "url", url: remoteResult },
    reference: remoteResult,
    source: privateSourceForImageUri(remoteResult),
    status: "available",
  };
}

function privateSourceForImageUri(uri: string): PrivateAssetSource {
  try {
    const url = new URL(uri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return { kind: "remote", url: uri };
    }
  } catch {
    // Validated data URIs are direct assets.
  }
  return { kind: "direct", uri };
}

function immediateImageSource(
  projection: ImageProjection,
): { readonly headers?: Record<string, string>; readonly uri: string } | null {
  if (projection.status === "unavailable" || projection.source.kind !== "direct") {
    return null;
  }
  return {
    uri: projection.source.uri,
    ...(projection.source.headers === undefined ? {} : { headers: projection.source.headers }),
  };
}

function createPreviewItem({
  block,
  galleryOrder,
  projection,
  source,
}: {
  readonly block: RenderBlock;
  readonly galleryOrder: number | undefined;
  readonly projection: ImageProjection;
  readonly source: { readonly headers?: Record<string, string>; readonly uri: string } | null;
}): ImagePreviewItem | null {
  if (projection.status === "unavailable" || source === null) {
    return null;
  }
  return {
    id:
      galleryOrder === undefined
        ? block.key
        : imageAttachmentPreviewId(projection.previewSource, galleryOrder),
    label:
      projection.previewSource.type === "path"
        ? `Image ${basename(projection.previewSource.path)}`
        : block.title,
    reference: projection.reference,
    source,
    ...(galleryOrder === undefined ? {} : { order: galleryOrder }),
  };
}

function unavailablePreviewItem(block: RenderBlock): ImagePreviewItem {
  return { id: block.key, label: block.title, source: { uri: "" } };
}
