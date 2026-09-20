import { useId, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";

import { privateAssetCacheKey } from "../../data/private-transfer";
import { useEphemeralAsyncResource } from "../../rendering/async-resource-store";
import {
  useDocumentDownload,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { materializePrivateAsset } from "../../rendering/private-asset";
import { useEvent } from "../../react/useEvent";
import { AppText as Text } from "../../ui/Typography";
import { RouteImagePreview } from "./RouteImagePreview";

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
        variant: "detail",
      }),
  );
  const retry = useEvent(() => {
    setRevision((current) => current + 1);
  });
  const download = useEvent(async () => downloadDocument(request));
  if (image.status === "ready" && image.value !== null) {
    return (
      <RouteImagePreview
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
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text selectable>{image.error ?? "Image preview failed"}</Text>
        <Pressable accessibilityRole="button" onPress={retry}>
          <Text>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
      <ActivityIndicator />
      <Text>Loading image…</Text>
    </View>
  );
}
