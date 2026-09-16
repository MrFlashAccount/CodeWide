import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

export const INLINE_MEDIA_PREVIEW_HEIGHT = 220;

/** Loading, decoded content and errors share geometry; only caller-owned metadata may size it. */
export function InlineMediaFrame({
  children,
  height = INLINE_MEDIA_PREVIEW_HEIGHT,
}: {
  children?: ReactNode;
  height?: number;
}) {
  return (
    <View style={[styles.frame, { height }]} testID="inline-media-frame">
      <View style={StyleSheet.absoluteFill}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
});
