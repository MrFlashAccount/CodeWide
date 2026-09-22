import { useId, useState } from "react";

import { privateAssetCacheKey } from "../../data/private-transfer";
import { useEphemeralAsyncResource } from "../../rendering/async-resource-store";
import {
  useDocumentDownload,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { materializePrivateAsset } from "../../rendering/private-asset";
import { createPrivateImageDetailRequest } from "../../rendering/use-private-image-uri";
import { useEvent } from "../../react/useEvent";
import { RouteImagePreview } from "./RouteImagePreview";
import { RouteImagePreviewStatus } from "./RouteImagePreviewStatus";

/** Loads one private image for the Router-owned image surface. */
export function RouteImageDocumentPreview({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: DocumentPreviewRequest;
}): React.JSX.Element {
  const ownerId = useId();
  const [revision, setRevision] = useState(0);
  const downloadDocument = useDocumentDownload();
  const source = request.source ?? { kind: "path" as const, path: request.path };
  const image = useEphemeralAsyncResource<{ headers: Record<string, string>; uri: string }>(
    `route-image:${ownerId}:${privateAssetCacheKey(source)}`,
    revision,
    async (_publish, signal) =>
      materializePrivateAsset(source, {
        getAccess: request.getTransferAccess,
        signal,
        variant: "preview",
      }),
  );
  const retry = useEvent(() => {
    setRevision((current) => current + 1);
  });
  const download = useEvent(async () => downloadDocument(request));
  if (image.status === "ready" && image.value !== null) {
    return (
      <RouteImagePreview
        detail={createPrivateImageDetailRequest(source, {
          accessScope: ownerId,
          getAccess: request.getTransferAccess,
          revision,
        })}
        download={download}
        id={`route-image:${request.path}`}
        label={request.name}
        onClose={onClose}
        reference={request.path}
        source={image.value}
      />
    );
  }
  if (image.status === "error") {
    return (
      <RouteImagePreviewStatus
        onClose={onClose}
        state={{ message: image.error ?? "Image preview failed", retry, status: "error" }}
      />
    );
  }
  return <RouteImagePreviewStatus onClose={onClose} state={{ status: "loading" }} />;
}
