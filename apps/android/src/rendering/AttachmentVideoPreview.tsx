import { useEvent as useExpoEvent } from "expo";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  privateAssetCacheKey,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";
import { colors, spacing, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { useEvent } from "../react/useEvent";
import { useEphemeralAsyncResource } from "./async-resource-store";
import { materializePrivateAsset } from "./private-asset";
import { usePrivateFileAccessScope } from "./use-private-image-uri";

interface VideoRequest {
  readonly getAccess: GetTransferAccess;
  readonly name: string;
  readonly source: PrivateAssetSource;
}
type VideoPreviewSource =
  | { readonly fallbackPath: string; readonly source?: undefined }
  | { readonly fallbackPath?: undefined; readonly source: PrivateAssetSource };
type VideoPreviewProps = VideoPreviewSource & {
  readonly getAccess: GetTransferAccess;
  readonly name: string;
  onClose: () => void;
  readonly scope: string;
};

export function isAttachmentVideo(name: string): boolean {
  return /\.(?:mp4|m4v|mov|webm|mkv)$/iu.test(name);
}

export function useAttachmentVideoPreview(): (request: VideoRequest) => void {
  const overlay = useAppFullscreenOverlay();
  const scope = usePrivateFileAccessScope();
  return useEvent((request: VideoRequest) => {
    overlay.present((controls) => (
      <AttachmentVideoPreview {...request} onClose={controls.close} scope={scope} />
    ));
  });
}

/** Renders one Router-owned private video without creating a second navigation layer. */
export function RouteAttachmentVideoPreview({
  getAccess,
  name,
  onClose,
  path,
  source,
}: Omit<VideoRequest, "source"> & {
  readonly onClose: () => void;
  readonly path: string;
  readonly source?: PrivateAssetSource;
}): React.JSX.Element {
  const scope = usePrivateFileAccessScope();
  if (source === undefined) {
    return (
      <AttachmentVideoPreview
        fallbackPath={path}
        getAccess={getAccess}
        name={name}
        onClose={onClose}
        scope={scope}
      />
    );
  }
  return (
    <AttachmentVideoPreview
      getAccess={getAccess}
      name={name}
      onClose={onClose}
      scope={scope}
      source={source}
    />
  );
}

function AttachmentVideoPreview(props: VideoPreviewProps) {
  const [revision, setRevision] = useState(0);
  const source = props.source ?? { kind: "path" as const, path: props.fallbackPath };
  const key = `attachment-video:${props.scope}:${privateAssetCacheKey(source)}`;
  const resource = useEphemeralAsyncResource<VideoSource>(key, revision, async (_publish, signal) =>
    materializePrivateAsset(source, { getAccess: props.getAccess, signal }),
  );
  const retry = () => {
    setRevision((value) => value + 1);
  };
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.title}>
          {props.name}
        </Text>
        <Pressable
          accessibilityLabel="Close video"
          accessibilityRole="button"
          onPress={props.onClose}
        >
          <Text style={styles.text}>Close</Text>
        </Pressable>
      </View>
      {resource.value !== null ? (
        <AttachmentVideoPlayer key={revision} onRetry={retry} source={resource.value} />
      ) : resource.status === "error" ? (
        <Pressable accessibilityLabel="Retry video" accessibilityRole="button" onPress={retry}>
          <Text style={styles.text}>{resource.error} · Retry</Text>
        </Pressable>
      ) : (
        <Text style={styles.text}>Loading video…</Text>
      )}
    </View>
  );
}

interface VideoPlayerProps {
  onRetry: () => void;
  readonly source: VideoSource;
}
function AttachmentVideoPlayer(props: VideoPlayerProps) {
  const player = useVideoPlayer(props.source, (created) => {
    created.play();
  });
  const event = useExpoEvent(player, "statusChange", { status: player.status });
  return (
    <View style={styles.player}>
      <VideoView contentFit="contain" nativeControls player={player} style={styles.player} />
      {event.status === "error" && (
        <Pressable
          accessibilityLabel="Retry video"
          accessibilityRole="button"
          onPress={props.onRetry}
        >
          <Text style={styles.text}>{event.error?.message ?? "Could not play video"} · Retry</Text>
        </Pressable>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  player: { flex: 1 },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
  text: {
    ...typeScale.body,
    color: colors.text,
    padding: spacing.sm,
  },
  title: {
    flex: 1,
    ...typeScale.title,
    color: colors.text,
  },
});
