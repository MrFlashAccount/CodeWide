import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

export interface VideoPreviewViewProps {
  children: ReactNode;
  title: string;
}

/** Protocol-neutral fullscreen frame. Playback and private-file access stay in
 * the injected platform capability instead of leaking into presentation. */
export function VideoPreviewView({ children, title }: VideoPreviewViewProps): React.JSX.Element {
  return (
    <View accessibilityLabel={`Video preview: ${title}`} style={styles.root}>
      <View style={styles.player}>{children}</View>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: "#000000",
    flex: 1,
  },
  player: {
    flex: 1,
  },
  title: {
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    bottom: 0,
    color: "#ffffff",
    fontSize: 14,
    left: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: "absolute",
    right: 0,
  },
});
