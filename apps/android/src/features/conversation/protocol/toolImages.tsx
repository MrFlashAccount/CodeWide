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
  getTransferAccess: (() => Promise<{ baseUrl: string; authorization: string }>) | undefined,
  renderFallback: (value: unknown) => ReactElement,
) {
  const projectedAsset = privateImageAssetProjection(item.codewideAsset);
  if (projectedAsset !== null && getTransferAccess !== undefined) {
    return (
      <ScopedPrivateAssetImage
        key={index}
        previewId={`tool-asset:${projectedAsset.id}`}
        label={`Tool image ${index + 1}`}
        reference={`private-asset:${projectedAsset.id}`}
        source={{ kind: "content", id: projectedAsset.id }}
        getTransferAccess={getTransferAccess}
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
      <Text key={index} selectable style={styles.rawLink}>
        {rawUri}
      </Text>
    ) : (
      <OpenableImage
        key={index}
        previewId={`tool-image:${index}:${uri}`}
        label={`Tool image ${index + 1}`}
        source={{ uri }}
        reference={uri}
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
        key={index}
        previewId={`mcp-image:${index}`}
        label={`MCP image ${index + 1}`}
        source={{ uri }}
        reference={`MCP image ${index + 1}`}
      />
    );
  }

  return null;
}
