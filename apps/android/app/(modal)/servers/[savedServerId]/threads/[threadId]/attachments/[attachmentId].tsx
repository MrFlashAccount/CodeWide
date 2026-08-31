import { Stack, useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { V2VideoPreview } from "@/v2/V2VideoPreview";
import { parseVideoPreviewRoute } from "@/v2/features/attachments/videoPreview";

const ERROR_FONT_SIZE = 15;
const ERROR_PADDING = 24;
const ERROR_SCREEN_OPTIONS = { headerShown: true, title: "Attachment" } as const;
const VIDEO_SCREEN_OPTIONS = { headerShown: true, title: "Video" } as const;

export default function AttachmentPreviewRoute(): React.JSX.Element {
  const result = parseVideoPreviewRoute(useLocalSearchParams());

  if (!result.ok) {
    return (
      <View accessibilityLabel="Attachment preview unavailable" style={styles.errorRoot}>
        <Stack.Screen options={ERROR_SCREEN_OPTIONS} />
        <Text style={styles.errorText}>{result.message}</Text>
      </View>
    );
  }

  const { model } = result;
  return (
    <View style={styles.root}>
      <Stack.Screen options={VIDEO_SCREEN_OPTIONS} />
      <V2VideoPreview model={model} />
    </View>
  );
}

const styles = StyleSheet.create({
  errorRoot: {
    alignItems: "center",
    backgroundColor: "#111111",
    flex: 1,
    justifyContent: "center",
    padding: ERROR_PADDING,
  },
  errorText: {
    color: "#ffffff",
    fontSize: ERROR_FONT_SIZE,
    textAlign: "center",
  },
  root: {
    flex: 1,
  },
});
