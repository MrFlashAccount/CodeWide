import { useEvent as useExpoEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { useTransition } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { VideoPlayerCapabilityProps } from "../../features/attachments/previewCapabilities";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { useEvent } from "../../../react/useEvent";

const FULLSCREEN_OPTIONS = { enable: true } as const;

export function ExpoVideoPlayer(props: VideoPlayerCapabilityProps): React.JSX.Element {
  const { autoplay, onRefreshSource, source, title } = props;
  const [retrying, startRetry] = useTransition();
  const accessibilityState = { busy: retrying, disabled: retrying };
  const player = useVideoPlayer(videoSource(source, title), (createdPlayer) => {
    if (autoplay) createdPlayer.play();
  });
  const statusEvent = useExpoEvent(player, "statusChange", { status: player.status });
  const playbackState = videoPlaybackState(statusEvent.status);
  const retry = useEvent((): void => {
    if (onRefreshSource === undefined || retrying) return;
    startRetry(async () => onRefreshSource());
  });
  return (
    <View style={styles.root}>
      <VideoView
        accessibilityLabel={`Video player · ${playbackState}`}
        accessibilityState={{ busy: playbackState === "loading" }}
        accessible
        allowsPictureInPicture={false}
        contentFit="contain"
        fullscreenOptions={FULLSCREEN_OPTIONS}
        nativeControls
        player={player}
        style={styles.video}
      />
      {isLoading(statusEvent.status) ? (
        <View accessibilityLabel="Loading video" pointerEvents="none" style={styles.overlay}>
          <ShimmerText style={styles.message} text="Loading video…" />
        </View>
      ) : null}
      {statusEvent.status === "error" ? (
        <View accessibilityLiveRegion="polite" style={styles.overlay}>
          <Text style={styles.error}>
            {statusEvent.error?.message ?? "Could not play this video"}
          </Text>
          {onRefreshSource === undefined ? null : (
            <Pressable
              accessibilityLabel="Retry video playback"
              accessibilityRole="button"
              accessibilityState={accessibilityState}
              disabled={retrying}
              onPress={retry}
              style={styles.retry}
            >
              {retrying ? (
                <ShimmerText text="Retrying…" />
              ) : (
                <Text style={styles.retryText}>Retry</Text>
              )}
            </Pressable>
          )}
        </View>
      ) : null}
    </View>
  );
}

function videoSource(source: VideoPlayerCapabilityProps["source"], title: string) {
  return {
    metadata: { title },
    ...(source.headers === null ? {} : { headers: source.headers }),
    uri: source.uri,
  };
}

function isLoading(status: string): boolean {
  return status === "idle" || status === "loading";
}

function videoPlaybackState(status: string): "error" | "loading" | "ready" {
  if (status === "error") return "error";
  return isLoading(status) ? "loading" : "ready";
}

const styles = StyleSheet.create({
  error: { color: colors.text, ...typeScale.body, maxWidth: "80%", textAlign: "center" },
  message: { color: colors.text, ...typeScale.body },
  overlay: {
    alignItems: "center",
    backgroundColor: colors.scrim,
    bottom: 0,
    gap: spacing.sm,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  retry: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  retryText: { color: colors.text, ...typeScale.label },
  root: { backgroundColor: colors.background, flex: 1 },
  video: { flex: 1 },
});
