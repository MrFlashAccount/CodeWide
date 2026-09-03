import type { V2Attachment } from "@codewide/sync-client/v2";
import { router } from "expo-router";

import type { LocalhostTunnelPort } from "../../application/ports/localhostBrowser";
import type { V2Runtime } from "../../application/v2Runtime";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { openExternalMarkdownLink } from "../../platform/rendering/openExternalMarkdownLink";
import type {
  ContentReviewAnchor,
  RenderingImageItem,
  RenderingImageSource,
  V2RenderingCapabilities,
} from "../../rendering/renderingCapabilities";
import { privateImageSourceUrl } from "../../rendering/privateImageReference";
import { attachmentForImageItem, attachmentForReference } from "../attachments/attachmentReference";
import type { AttachmentAnnotationCapability } from "../attachments/attachmentAnnotation";
import { createAttachmentRenderingCapabilities } from "../attachments/createAttachmentRenderingCapabilities";
import {
  reviewResponseDestination,
  workspaceFilePreviewDestination,
} from "../navigation/routeDestinations";
import { createOpenLoopbackLink } from "../ports/openLoopbackLink";

const RESPONSE_TARGET_PREFIX = "agent-response:";
const NOOP = (): void => undefined;

export interface CreateV2RenderingCapabilitiesInput {
  annotate: AttachmentAnnotationCapability;
  attachments: readonly V2Attachment[];
  owner: QualifiedThread;
  ports: LocalhostTunnelPort;
  runtime: V2Runtime;
}

/**
 * Composes RichMarkdown with V2's typed routes and authenticated runtime ports.
 * The renderer still owns safe public-image and full-output fallbacks; private
 * resources never escape PreviewTransport or the qualified attachment route.
 */
export function createV2RenderingCapabilities(
  input: CreateV2RenderingCapabilitiesInput,
): V2RenderingCapabilities {
  const attachments = createAttachmentRenderingCapabilities({
    annotate: input.annotate,
    attachments: input.attachments,
    navigate: router.push,
    openWorkspaceFile(path) {
      router.push(workspaceFilePreviewDestination(input.owner, path));
    },
    owner: input.owner,
    preparePreview(attachments, selected) {
      input.runtime.attachmentPreviews.present(input.owner, attachments, selected);
    },
    preview(savedServerId, sourceUrl, mode) {
      return input.runtime.preview(savedServerId, sourceUrl, mode);
    },
  });
  const openImagePreview = (items: RenderingImageItem[], selectedId: string): boolean =>
    attachments.openImagePreview(items, selectedId);
  const annotateImage = attachments.annotateImage;
  if (annotateImage === undefined) {
    throw new Error("Attachment annotation capability was not composed");
  }
  return {
    annotateImage,
    beginReview(anchor) {
      const response = responseReviewTarget(anchor);
      if (response === null) throw new Error("This content does not have a V2 response target");
      router.push(reviewResponseDestination(input.owner, response.turnId, response.itemId));
    },
    canAnnotateImage(item) {
      return attachmentForImageItem(input.attachments, item) !== null;
    },
    canOpenLocalDocument(href) {
      return attachments.canOpenLocalDocument(href);
    },
    imageSourceRevision: attachments.imageSourceRevision,
    openExternalLink: openExternalMarkdownLink,
    openImagePreview,
    openLocalDocument: attachments.openLocalDocument,
    openLoopbackLink: createOpenLoopbackLink(input.owner.savedServerId, input.ports),
    resolveImageSource(reference) {
      const privateSourceUrl = privateImageSourceUrl(reference);
      if (privateSourceUrl !== null) {
        return resolvePrivateImage(input, privateSourceUrl);
      }
      if (attachmentForReference(input.attachments, reference) === null) return null;
      return (
        attachments.resolveImageSource(reference) ??
        attachments.resolvePrivateImageSource(reference)
      );
    },
  };
}

async function resolvePrivateImage(
  input: CreateV2RenderingCapabilitiesInput,
  sourceUrl: string,
): Promise<RenderingImageSource | null> {
  const resource = input.runtime.preview(input.owner.savedServerId, sourceUrl, "image");
  const initial = resource.snapshot();
  const settled =
    initial.status === "loading"
      ? await new Promise<ReturnType<typeof resource.snapshot>>((resolve) => {
          let unsubscribe = NOOP;
          const publish = (): void => {
            const snapshot = resource.snapshot();
            if (snapshot.status === "loading") return;
            unsubscribe();
            resolve(snapshot);
          };
          unsubscribe = resource.subscribe(publish);
          publish();
        })
      : initial;
  if (settled.status === "error" || settled.value.stream === null) return null;
  return settled.value.stream.headers === null
    ? { uri: settled.value.stream.uri }
    : { headers: settled.value.stream.headers, uri: settled.value.stream.uri };
}

interface ResponseReviewTarget {
  itemId: string;
  turnId: string;
}

function responseReviewTarget(anchor: ContentReviewAnchor): ResponseReviewTarget | null {
  if (!anchor.targetId.startsWith(RESPONSE_TARGET_PREFIX)) return null;
  const reference = anchor.targetId.slice(RESPONSE_TARGET_PREFIX.length);
  const separator = reference.indexOf(":");
  if (separator <= 0 || separator >= reference.length - 1) return null;
  return {
    itemId: reference.slice(separator + 1),
    turnId: reference.slice(0, separator),
  };
}
