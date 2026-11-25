import type { ReactElement } from "react";
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { spacing } from "../theme";
import { MESSAGE_VIDEO_PREVIEW_WIDTH } from "./videoPreview";

interface MessageVideoGalleryProps {
  readonly children: readonly ReactElement[];
  readonly style?: StyleProp<ViewStyle>;
}

/** Keeps video previews image-sized while additional videos scroll horizontally. */
export function MessageVideoGallery(props: MessageVideoGalleryProps): React.JSX.Element {
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      style={[styles.viewport, props.style]}
      testID="message-video-gallery"
    >
      {props.children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    flexDirection: "row",
    gap: spacing.xxs,
  },
  viewport: {
    alignSelf: "flex-start",
    flexGrow: 0,
    maxWidth: "100%",
    width: MESSAGE_VIDEO_PREVIEW_WIDTH,
  },
});
