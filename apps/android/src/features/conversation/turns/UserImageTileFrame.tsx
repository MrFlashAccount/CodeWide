import type { ReactElement, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { styles } from "./UserMessageContent.styles";

const USER_IMAGE_HERO_HEIGHT = 180;
const USER_IMAGE_TILE_SIZE = 156;

/** Preserves user-image geometry while the preview moves through loading and decoded states. */
export function UserImageTileFrame({
  children,
  layout,
}: {
  readonly children: ReactNode;
  readonly layout: "hero" | "tile";
}): ReactElement {
  return (
    <View
      style={[styles.userImageFrame, layout === "hero" ? frameStyles.hero : frameStyles.tile]}
      testID="user-image-tile-frame"
    >
      {children}
    </View>
  );
}

const frameStyles = StyleSheet.create({
  hero: {
    alignSelf: "stretch",
    height: USER_IMAGE_HERO_HEIGHT,
    width: "100%",
  },
  tile: {
    alignSelf: "flex-start",
    height: USER_IMAGE_TILE_SIZE,
    width: USER_IMAGE_TILE_SIZE,
  },
});
