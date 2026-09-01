import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";

import { spacing, typeScale } from "../../theme";

export interface VideoPreviewViewProps {
  children: ReactNode;
  title: string;
}

/** Protocol-neutral fullscreen frame. Playback and private-file access stay in
 * the injected platform capability instead of leaking into presentation. */
export function VideoPreviewView(props: VideoPreviewViewProps): React.JSX.Element {
  const { children, title } = props;
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
    ...typeScale.body,
    left: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: "absolute",
    right: 0,
  },
});
