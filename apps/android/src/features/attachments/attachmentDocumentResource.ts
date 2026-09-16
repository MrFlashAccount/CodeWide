import { projectCompleteMarkdown } from "@codewide/rendering-core";
import type { useId } from "react";
import { privateAssetCacheKey } from "../../data/private-transfer";
import { useEphemeralAsyncResource } from "../../rendering/async-resource-store";
import {
  loadDocumentPreview,
  type DocumentPreviewResult,
} from "../../rendering/DocumentPreviewHost";
import type { ThreadResourceDocumentRoute } from "./documentNavigation";

/** Owns the stable document preview resource and its loading/error snapshot for the current route. */
export function useAttachmentDocumentResource({
  document,
  previewResourceOwnerId,
}: {
  document: ThreadResourceDocumentRoute | null;
  previewResourceOwnerId: ReturnType<typeof useId>;
}) {
  const documentSource =
    document?.request.source ??
    (document === null ? null : { kind: "path" as const, path: document.request.path });
  const documentPreviewResource = useEphemeralAsyncResource<
    Extract<DocumentPreviewResult, { phase: "ready" }>
  >(
    document === null || documentSource === null
      ? null
      : `thread-resource-document:${previewResourceOwnerId}:${privateAssetCacheKey(documentSource)}`,
    document === null ? "none" : `${document.request.kind}:${String(document.revision)}`,
    async (_publish, signal) => {
      if (document === null) {
        throw new Error("Document preview is closed");
      }
      const loaded = await loadDocumentPreview(document.request, signal);
      return {
        phase: "ready",
        segments:
          document.request.kind === "markdown" ? projectCompleteMarkdown(loaded.source) : [],
        source: loaded.source,
        truncated: loaded.truncated,
      };
    },
    (value) => value.source.length * 2,
  );
  const documentResult: DocumentPreviewResult =
    documentPreviewResource.status === "ready" && documentPreviewResource.value !== null
      ? documentPreviewResource.value
      : documentPreviewResource.status === "error"
        ? { message: documentPreviewResource.error ?? "Document preview failed", phase: "error" }
        : { phase: "loading" };
  return { documentResult };
}
