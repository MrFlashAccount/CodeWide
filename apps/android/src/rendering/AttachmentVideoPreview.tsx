import Ionicons from "@expo/vector-icons/Ionicons";
import { useEvent as useExpoEvent } from "expo";
import { useVideoPlayer, VideoView, type VideoSource } from "expo-video";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  privateAssetCacheKey,
  type GetTransferAccess,
  type PrivateAssetSource,
} from "../data/private-transfer";
import { useEvent } from "../react/useEvent";
import {
  colors,
  controlSize,
  iconSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../theme";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { useOverlaySurface } from "../ui/OverlaySurfaceContext";
import { percentageDimension } from "../ui/percentageDimension";
import { AppText as Text } from "../ui/Typography";
import { useEphemeralAsyncResource } from "./async-resource-store";
import {
  ContentReviewComments,
  ContentReviewComposer,
  useContentReview,
  useVideoReviewPoints,
  type ContentReviewPoint,
} from "./ContentReviewHost";
import { materializePrivateAsset } from "./private-asset";
import { usePrivateFileAccessScope } from "./use-private-image-uri";
import { MESSAGE_VIDEO_PREVIEW_HEIGHT, MESSAGE_VIDEO_PREVIEW_WIDTH } from "./videoPreview";

interface VideoRequest {
  readonly getAccess: GetTransferAccess;
  readonly name: string;
  readonly reference: string;
  readonly source: PrivateAssetSource;
}

type VideoPreviewSource =
  | { readonly fallbackPath: string; readonly source?: undefined }
  | { readonly fallbackPath?: undefined; readonly source: PrivateAssetSource };

type VideoPreviewProps = VideoPreviewSource & {
  readonly getAccess: GetTransferAccess;
  readonly name: string;
  onClose: () => void;
  readonly reference: string;
  readonly scope: string;
};

interface MessageVideoPreviewProps extends VideoRequest {
  onOpen: () => void;
}

type VideoSize = { readonly height: number; readonly width: number };

const REVIEW_POINT_PERCENT = 100;
const PENDING_POINT_OPACITY = 0.6;
const HALF = 2;

export function useAttachmentVideoPreview(): (request: VideoRequest) => void {
  const overlay = useAppFullscreenOverlay();
  const scope = usePrivateFileAccessScope();
  return useEvent((request: VideoRequest) => {
    overlay.present((controls) => (
      <AttachmentVideoPreview {...request} onClose={controls.close} scope={scope} />
    ));
  });
}

/** A paused, muted video surface that behaves like an image attachment preview. */
export function MessageVideoPreview(props: MessageVideoPreviewProps): React.JSX.Element {
  const scope = usePrivateFileAccessScope();
  const [revision, setRevision] = useState(0);
  const resource = useVideoResource({
    getAccess: props.getAccess,
    revision,
    scope,
    source: props.source,
  });
  const retry = useEvent(() => {
    setRevision((value) => value + 1);
  });
  if (resource.status === "error") {
    return (
      <Pressable
        accessibilityLabel={`Retry preview for ${props.name}`}
        accessibilityRole="button"
        onPress={retry}
        style={styles.messagePreview}
      >
        <Ionicons
          color={colors.textMuted}
          name="videocam-off-outline"
          size={iconSize.illustration}
        />
        <Text numberOfLines={2} style={styles.messagePreviewStatus}>
          Video preview failed · Retry
        </Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.messagePreview} testID="message-video-preview">
      {resource.value === null ? (
        <ActivityIndicator color={colors.textMuted} />
      ) : (
        <InlineVideoSurface key={revision} source={resource.value} />
      )}
      <View pointerEvents="none" style={styles.messagePreviewShade} />
      <View pointerEvents="none" style={styles.messagePlayButton}>
        <Ionicons color="#ffffff" name="play" size={iconSize.navigation} />
      </View>
      <View pointerEvents="none" style={styles.messagePreviewCaption}>
        <Ionicons color="#ffffff" name="videocam-outline" size={iconSize.inline} />
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.messagePreviewName}>
          {props.name}
        </Text>
      </View>
      <Pressable
        accessibilityLabel={`Open ${props.name}`}
        accessibilityRole="button"
        onPress={props.onOpen}
        style={({ pressed }) => [
          styles.messagePreviewPressTarget,
          pressed && styles.messagePreviewPressed,
        ]}
      />
    </View>
  );
}

/** Renders one Router-owned private video without creating a second navigation layer. */
export function RouteAttachmentVideoPreview({
  getAccess,
  name,
  onClose,
  path,
  source,
}: Omit<VideoRequest, "reference" | "source"> & {
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
        reference={path}
        scope={scope}
      />
    );
  }
  return (
    <AttachmentVideoPreview
      getAccess={getAccess}
      name={name}
      onClose={onClose}
      reference={path}
      scope={scope}
      source={source}
    />
  );
}

function AttachmentVideoPreview(props: VideoPreviewProps): React.JSX.Element {
  const [revision, setRevision] = useState(0);
  const source = props.source ?? { kind: "path" as const, path: props.fallbackPath };
  const resource = useVideoResource({
    getAccess: props.getAccess,
    revision,
    scope: props.scope,
    source,
  });
  const retry = useEvent(() => {
    setRevision((value) => value + 1);
  });
  return (
    <View style={styles.fullscreenRoot} testID="video-preview-surface">
      <FullscreenVideoResource
        key={revision}
        name={props.name}
        onClose={props.onClose}
        onRetry={retry}
        reference={props.reference}
        resource={resource}
        reviewTargetId={`video:${props.scope}:${privateAssetCacheKey(source)}`}
      />
    </View>
  );
}

function FullscreenVideoResource({
  name,
  onClose,
  onRetry,
  reference,
  resource,
  reviewTargetId,
}: {
  readonly name: string;
  onClose: () => void;
  onRetry: () => void;
  readonly reference: string;
  readonly resource: ReturnType<typeof useVideoResource>;
  readonly reviewTargetId: string;
}): React.JSX.Element {
  if (resource.value === null) {
    return (
      <FullscreenVideoPending
        error={resource.status === "error" ? resource.error : null}
        name={name}
        onClose={onClose}
        onRetry={onRetry}
      />
    );
  }
  return (
    <FullscreenVideoPlayer
      name={name}
      onClose={onClose}
      onRetry={onRetry}
      reference={reference}
      reviewTargetId={reviewTargetId}
      source={resource.value}
    />
  );
}

function FullscreenVideoPending({
  error,
  name,
  onClose,
  onRetry,
}: {
  readonly error: string | null;
  readonly name: string;
  onClose: () => void;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <>
      <FullscreenVideoToolbar name={name} onClose={onClose} pinMode={false} />
      <View style={styles.fullscreenStatus}>
        <FullscreenVideoPendingState error={error} onRetry={onRetry} />
      </View>
    </>
  );
}

function FullscreenVideoPendingState({
  error,
  onRetry,
}: {
  readonly error: string | null;
  onRetry: () => void;
}): React.JSX.Element {
  if (error === null) {
    return <ActivityIndicator color="#ffffff" />;
  }
  return (
    <Pressable
      accessibilityLabel="Retry video"
      accessibilityRole="button"
      onPress={onRetry}
      style={styles.retryButton}
    >
      <Text style={styles.fullscreenStatusText}>{error} · Retry</Text>
    </Pressable>
  );
}

function useVideoResource({
  getAccess,
  revision,
  scope,
  source,
}: {
  readonly getAccess: GetTransferAccess;
  readonly revision: number;
  readonly scope: string;
  readonly source: PrivateAssetSource;
}) {
  const key = `attachment-video:${scope}:${privateAssetCacheKey(source)}`;
  return useEphemeralAsyncResource<VideoSource>(key, revision, async (_publish, signal) =>
    materializePrivateAsset(source, { getAccess, signal }),
  );
}

function InlineVideoSurface({ source }: { readonly source: VideoSource }): React.JSX.Element {
  const player = useVideoPlayer(source, (created) => {
    created.keepScreenOnWhilePlaying = false;
    created.muted = true;
    created.pause();
  });
  return (
    <VideoView
      contentFit="cover"
      nativeControls={false}
      player={player}
      pointerEvents="none"
      style={styles.fill}
      surfaceType="textureView"
    />
  );
}

function FullscreenVideoPlayer({
  name,
  onClose,
  onRetry,
  reference,
  reviewTargetId,
  source,
}: {
  readonly name: string;
  onClose: () => void;
  onRetry: () => void;
  readonly reference: string;
  readonly reviewTargetId: string;
  readonly source: VideoSource;
}): React.JSX.Element {
  const player = useVideoPlayer(source, (created) => {
    created.play();
  });
  const status = useExpoEvent(player, "statusChange", { status: player.status });
  const track = useExpoEvent(player, "videoTrackChange", { videoTrack: player.videoTrack });
  const insets = useSafeAreaInsets();
  const { surface } = useOverlaySurface();
  const topInset = surface === "fullscreen-modal" ? 0 : insets.top;
  const bottomInset = surface === "fullscreen-modal" ? 0 : insets.bottom;
  const [pinMode, setPinMode] = useState(false);
  const [viewport, setViewport] = useState<VideoSize>({ height: 0, width: 0 });
  const intrinsic = track.videoTrack?.size ?? { height: 0, width: 0 };
  const frame = containSize(intrinsic, viewport);
  const review = useContentReview();
  const points = useVideoReviewPoints(reviewTargetId);
  const togglePin = useEvent(() => {
    setPinMode((current) => {
      if (!current) {
        player.pause();
      }
      return !current;
    });
  });
  const placePin = useEvent((event: GestureResponderEvent) => {
    if (frame.width <= 0 || frame.height <= 0) {
      return;
    }
    review({
      kind: "video",
      target: { id: reviewTargetId, label: name, reference },
      timeSeconds: player.currentTime,
      x: event.nativeEvent.locationX / frame.width,
      y: event.nativeEvent.locationY / frame.height,
    });
  });
  return (
    <View style={[styles.fullscreenRoot, { paddingBottom: bottomInset, paddingTop: topInset }]}>
      <View
        onLayout={({ nativeEvent }) => {
          setViewport({
            height: Math.max(0, nativeEvent.layout.height),
            width: Math.max(0, nativeEvent.layout.width),
          });
        }}
        style={styles.fullscreenViewport}
        testID="video-preview-viewport"
      >
        <View style={[styles.videoFrame, frame]} testID="video-preview-frame">
          <VideoView
            contentFit="contain"
            nativeControls={!pinMode}
            player={player}
            style={styles.fill}
          />
          <VideoPinSurface active={pinMode} onPress={placePin} />
          <VideoReviewPoints points={points} />
        </View>
        <VideoPlayerError
          message={
            status.status === "error"
              ? (status.error?.message ?? "Could not play video")
              : undefined
          }
          onRetry={onRetry}
        />
      </View>
      <ContentReviewComments
        bottomOffset={controlSize.touch + spacing.lg}
        presentation="overlay"
        targetId={reviewTargetId}
      />
      <ContentReviewComposer anchorKind="video" targetId={reviewTargetId} />
      <FullscreenVideoToolbar
        name={name}
        onClose={onClose}
        onTogglePin={togglePin}
        pinMode={pinMode}
        top={topInset + spacing.xs}
      />
    </View>
  );
}

function VideoPinSurface({
  active,
  onPress,
}: {
  readonly active: boolean;
  onPress: (event: GestureResponderEvent) => void;
}): React.JSX.Element | null {
  if (!active) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel="Place video review point"
      accessibilityRole="button"
      onPress={onPress}
      style={StyleSheet.absoluteFill}
    />
  );
}

function VideoReviewPoints({
  points,
}: {
  readonly points: readonly ContentReviewPoint[];
}): React.JSX.Element {
  return (
    <>
      {points.map((point, index) => (
        <VideoReviewPoint index={index} key={point.id} point={point} />
      ))}
    </>
  );
}

function VideoReviewPoint({
  index,
  point,
}: {
  readonly index: number;
  readonly point: ContentReviewPoint;
}): React.JSX.Element {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.pin,
        {
          left: percentageDimension(point.x * REVIEW_POINT_PERCENT),
          opacity: point.pending ? PENDING_POINT_OPACITY : 1,
          top: percentageDimension(point.y * REVIEW_POINT_PERCENT),
        },
      ]}
    >
      <Text style={styles.pinText}>{index + 1}</Text>
    </View>
  );
}

function VideoPlayerError({
  message,
  onRetry,
}: {
  readonly message: string | undefined;
  onRetry: () => void;
}): React.JSX.Element | null {
  if (message === undefined) {
    return null;
  }
  return (
    <Pressable
      accessibilityLabel="Retry video"
      accessibilityRole="button"
      onPress={onRetry}
      style={styles.playerError}
    >
      <Text style={styles.fullscreenStatusText}>{message} · Retry</Text>
    </Pressable>
  );
}

function FullscreenVideoToolbar({
  name,
  onClose,
  onTogglePin,
  pinMode,
  top = spacing.xs,
}: {
  readonly name: string;
  onClose: () => void;
  onTogglePin?: () => void;
  readonly pinMode: boolean;
  readonly top?: number;
}): React.JSX.Element {
  return (
    <View pointerEvents="box-none" style={[styles.topBar, { top }]} testID="video-preview-controls">
      <Pressable
        accessibilityLabel="Close video"
        accessibilityRole="button"
        onPress={onClose}
        style={styles.roundButton}
      >
        <Ionicons color="#ffffff" name="close" size={iconSize.navigation} />
      </Pressable>
      <View style={styles.titlePill}>
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.titleText}>
          {name}
        </Text>
      </View>
      {onTogglePin === undefined ? (
        <View style={styles.toolbarSpacer} />
      ) : (
        <Pressable
          accessibilityLabel="Pin a comment on video"
          accessibilityRole="button"
          accessibilityState={{ selected: pinMode }}
          onPress={onTogglePin}
          style={styles.roundButton}
        >
          <Ionicons
            color={pinMode ? "#B794F6" : "#ffffff"}
            name={pinMode ? "pin" : "pin-outline"}
            size={iconSize.action}
          />
        </Pressable>
      )}
    </View>
  );
}

function containSize(intrinsic: VideoSize, viewport: VideoSize): VideoSize {
  if (
    intrinsic.width <= 0 ||
    intrinsic.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return viewport;
  }
  const ratio = Math.min(viewport.width / intrinsic.width, viewport.height / intrinsic.height);
  return { height: intrinsic.height * ratio, width: intrinsic.width * ratio };
}

const styles = StyleSheet.create({
  fill: {
    height: "100%",
    width: "100%",
  },
  fullscreenRoot: {
    backgroundColor: "#000000",
    flex: 1,
  },
  fullscreenStatus: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  fullscreenStatusText: {
    color: "#ffffff",
    ...typeScale.body,
    textAlign: "center",
  },
  fullscreenViewport: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  messagePlayButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.68)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    left: "50%",
    marginLeft: -touchTarget / HALF,
    marginTop: -touchTarget / HALF,
    position: "absolute",
    top: "50%",
    width: touchTarget,
  },
  messagePreview: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.small,
    height: MESSAGE_VIDEO_PREVIEW_HEIGHT,
    justifyContent: "center",
    maxWidth: "100%",
    overflow: "hidden",
    width: MESSAGE_VIDEO_PREVIEW_WIDTH,
  },
  messagePreviewCaption: {
    alignItems: "center",
    bottom: spacing.xs,
    flexDirection: "row",
    gap: spacing.xxs,
    left: spacing.xs,
    position: "absolute",
    right: spacing.xs,
  },
  messagePreviewName: {
    color: "#ffffff",
    flex: 1,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  messagePreviewPressed: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  messagePreviewPressTarget: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  messagePreviewShade: {
    backgroundColor: "rgba(0,0,0,0.2)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  messagePreviewStatus: {
    color: colors.textMuted,
    ...typeScale.label,
    padding: spacing.sm,
    textAlign: "center",
  },
  pin: {
    alignItems: "center",
    backgroundColor: "#B794F6",
    borderRadius: radii.pill,
    height: controlSize.compact,
    justifyContent: "center",
    marginLeft: -controlSize.compact / HALF,
    marginTop: -controlSize.compact / HALF,
    position: "absolute",
    width: controlSize.compact,
  },
  pinText: {
    color: "#000000",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  playerError: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    padding: spacing.lg,
    position: "absolute",
    right: 0,
    top: 0,
  },
  retryButton: {
    padding: spacing.lg,
  },
  roundButton: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.9)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  titlePill: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.82)",
    borderRadius: radii.medium,
    flex: 1,
    justifyContent: "center",
    marginHorizontal: spacing.sm,
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  titleText: {
    color: "#ffffff",
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  toolbarSpacer: {
    height: touchTarget,
    width: touchTarget,
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    left: spacing.sm,
    position: "absolute",
    right: spacing.sm,
  },
  videoFrame: {
    position: "relative",
  },
});
