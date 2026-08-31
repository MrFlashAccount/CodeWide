import { useEvent } from "expo";
import { useVideoPlayer, VideoView } from "expo-video";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import type { VideoPlayerCapabilityProps } from "../../features/attachments/VideoPreviewScreen";

const ERROR_FONT_SIZE = 15;
const ERROR_MAX_WIDTH = 420;
const ERROR_PADDING = 24;
const FULLSCREEN_OPTIONS = { enable: true } as const;

export function ExpoVideoPlayer({
  autoplay,
  source,
  title,
}: VideoPlayerCapabilityProps): React.JSX.Element {
  const player = useVideoPlayer(
    {
      metadata: { title },
      uri: source.uri,
    },
    (createdPlayer) => {
      if (autoplay) {
        createdPlayer.play();
      }
    },
  );
  const statusEvent = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { error, status } = statusEvent;

  return (
    <View style={styles.root}>
      <VideoView
        allowsPictureInPicture={false}
        contentFit="contain"
        fullscreenOptions={FULLSCREEN_OPTIONS}
        nativeControls
        player={player}
        style={styles.video}
      />
      {isLoading(status) && (
        <View accessibilityLabel="Loading video" pointerEvents="none" style={styles.overlay}>
          <ActivityIndicator color="#ffffff" size="large" />
        </View>
      )}
      {status === "error" && (
        <View
          accessibilityLabel="Video playback failed"
          pointerEvents="none"
          style={styles.overlay}
        >
          <Text style={styles.error}>{error?.message ?? "Could not play this video"}</Text>
        </View>
      )}
    </View>
  );
}

function isLoading(status: string): boolean {
  return status === "idle" || status === "loading";
}

const styles = StyleSheet.create({
  error: {
    color: "#ffffff",
    fontSize: ERROR_FONT_SIZE,
    maxWidth: ERROR_MAX_WIDTH,
    paddingHorizontal: ERROR_PADDING,
    textAlign: "center",
  },
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.64)",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  root: {
    backgroundColor: "#000000",
    flex: 1,
  },
  video: {
    flex: 1,
  },
});
