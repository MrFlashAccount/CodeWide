/** V1 ToolContent owner, extracted without changing interaction or resource lifetime. */
import { privateImageAssetProjection, safeImageUri } from "../../../rendering/image-source";
import { AppText as Text } from "../../../ui/Typography";
import { OpenableImage, ScopedPrivateAssetImage } from "./ImageProtocolBlock";
import { styles } from "./ToolContent.styles";

import type { ReactElement } from "react";
/** Renders image variants without taking ownership of protocol body disclosure. */
export function renderToolImage(
  item: Record<string, unknown>,
  type: string,
  index: number,
  key: string,
  getTransferAccess: (() => Promise<{ authorization: string; baseUrl: string }>) | undefined,
  renderFallback: (value: unknown) => ReactElement,
) {
  const projectedAsset = privateImageAssetProjection(item.codewideAsset);
  if (projectedAsset !== null && getTransferAccess !== undefined) {
    return (
      <ScopedPrivateAssetImage
        getTransferAccess={getTransferAccess}
        key={key}
        label={`Tool image ${String(index + 1)}`}
        previewId={`tool-asset:${projectedAsset.id}`}
        reference={`private-asset:${projectedAsset.id}`}
        source={{ id: projectedAsset.id, kind: "content" }}
      />
    );
  }
  if (
    (type === "inputImage" || type === "input_image") &&
    (typeof item.imageUrl === "string" || typeof item.image_url === "string")
  ) {
    const rawUri = typeof item.imageUrl === "string" ? item.imageUrl : String(item.image_url);
    const uri = safeImageUri(rawUri);
    return uri === null ? (
      <Text key={key} selectable style={styles.rawLink}>
        {rawUri}
      </Text>
    ) : (
      <OpenableImage
        key={key}
        label={`Tool image ${String(index + 1)}`}
        previewId={`tool-image:${String(index)}:${uri}`}
        reference={uri}
        source={{ uri }}
      />
    );
  }
  if (type === "image" && typeof item.data === "string") {
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
    const uri = safeImageUri(`data:${mimeType};base64,${item.data}`);
    return uri === null ? (
      renderFallback(item)
    ) : (
      <OpenableImage
        key={key}
        label={`MCP image ${String(index + 1)}`}
        previewId={`mcp-image:${String(index)}`}
        reference={`MCP image ${String(index + 1)}`}
        source={{ uri }}
      />
    );
  }

  return null;
}
