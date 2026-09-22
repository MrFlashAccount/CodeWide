import { useState } from "react";
import { Image, StyleSheet } from "react-native";

import type { PrivateAssetSource } from "../data/private-transfer";
import type { PrivateImageDetailRequest } from "./use-private-image-uri";
import { usePrivateAssetUri } from "./use-private-image-uri";

type DecodeState = "error" | "loading" | "ready";
type ImageSize = { height: number; width: number };
type ResolvedImageSource = { headers?: Record<string, string>; uri: string };

/** Keeps the preview visible until detail decode succeeds, then releases it. */
export function ProgressiveImageLayer({
  detail,
  label,
  onDecodeStateChange,
  onDimensions,
  preview,
}: {
  detail?: PrivateImageDetailRequest | null | undefined;
  label: string;
  onDecodeStateChange: (state: DecodeState) => void;
  onDimensions: (size: ImageSize) => void;
  preview: ResolvedImageSource;
}): React.JSX.Element {
  const request = progressiveImageRequest(detail);
  const detailSource = usePrivateAssetUri(request.source, request.options).source;
  return (
    <ProgressiveImageFrames
      detail={detailSource}
      label={label}
      onDecodeStateChange={onDecodeStateChange}
      onDimensions={onDimensions}
      preview={preview}
      resizeMethod={detail === null || detail === undefined ? "resize" : "scale"}
    />
  );
}

/** Keeps a decoded preview above the detail surface until the replacement frame is ready. */
export function ProgressiveImageFrames({
  detail,
  label,
  onDecodeStateChange,
  onDimensions,
  preview,
  resizeMethod = "resize",
}: {
  detail: ResolvedImageSource | null;
  label: string;
  onDecodeStateChange: (state: DecodeState) => void;
  onDimensions: (size: ImageSize) => void;
  preview: ResolvedImageSource;
  /** Server derivatives are bounded to 640/2560px; retain those pixels across layout and zoom. */
  resizeMethod?: "resize" | "scale";
}): React.JSX.Element {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const [readyUri, setReadyUri] = useState<string | null>(null);
  return (
    <>
      <DetailImageLayer
        failedUri={failedUri}
        label={label}
        onDecodeStateChange={onDecodeStateChange}
        onDimensions={onDimensions}
        onFailed={setFailedUri}
        onReady={setReadyUri}
        resizeMethod={resizeMethod}
        source={detail}
      />
      <PreviewImageLayer
        label={label}
        onDecodeStateChange={onDecodeStateChange}
        onDimensions={onDimensions}
        preview={preview}
        resizeMethod={resizeMethod}
        visible={detail === null || readyUri !== detail.uri}
      />
    </>
  );
}

function PreviewImageLayer({
  label,
  onDecodeStateChange,
  onDimensions,
  preview,
  resizeMethod,
  visible,
}: {
  label: string;
  onDecodeStateChange: (state: DecodeState) => void;
  onDimensions: (size: ImageSize) => void;
  preview: ResolvedImageSource;
  resizeMethod: "resize" | "scale";
  visible: boolean;
}): React.JSX.Element | null {
  if (!visible) {
    return null;
  }
  return (
    <Image
      accessibilityLabel={`${label} full screen`}
      onError={() => {
        onDecodeStateChange("error");
      }}
      onLoad={({ nativeEvent }) => {
        onDecodeStateChange("ready");
        publishLoadedDimensions(nativeEvent.source, onDimensions);
      }}
      onLoadStart={() => {
        onDecodeStateChange("loading");
      }}
      resizeMethod={resizeMethod}
      resizeMode="contain"
      source={preview}
      style={styles.image}
    />
  );
}

function DetailImageLayer({
  failedUri,
  label,
  onDecodeStateChange,
  onDimensions,
  onFailed,
  onReady,
  resizeMethod,
  source,
}: {
  failedUri: string | null;
  label: string;
  onDecodeStateChange: (state: DecodeState) => void;
  onDimensions: (size: ImageSize) => void;
  onFailed: (uri: string) => void;
  onReady: (uri: string) => void;
  resizeMethod: "resize" | "scale";
  source: ResolvedImageSource | null;
}): React.JSX.Element | null {
  if (source === null || failedUri === source.uri) {
    return null;
  }
  return (
    <Image
      accessibilityLabel={`${label} high quality`}
      onError={() => {
        onFailed(source.uri);
      }}
      onLoad={({ nativeEvent }) => {
        onReady(source.uri);
        onDecodeStateChange("ready");
        publishLoadedDimensions(nativeEvent.source, onDimensions);
      }}
      resizeMethod={resizeMethod}
      resizeMode="contain"
      source={source}
      style={styles.image}
    />
  );
}

function progressiveImageRequest(detail: PrivateImageDetailRequest | null | undefined): {
  options: Parameters<typeof usePrivateAssetUri>[1];
  source: PrivateAssetSource | null;
} {
  if (detail === null || detail === undefined) {
    return { options: { variant: "detail" }, source: null };
  }
  return {
    options: {
      access: detail.getAccess,
      accessScope: detail.accessScope,
      revision: detail.revision,
      variant: "detail",
    },
    source: detail.source,
  };
}

function publishLoadedDimensions(
  // React Native Web omits this runtime field although the shared event type marks it as required.
  loadedSource: ImageSize | undefined,
  onDimensions: (size: ImageSize) => void,
): void {
  if (loadedSource === undefined) {
    return;
  }
  const { height, width } = loadedSource;
  if (width > 0 && height > 0) {
    onDimensions({ height, width });
  }
}

const styles = StyleSheet.create({
  image: {
    bottom: 0,
    height: "100%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: "100%",
  },
});
