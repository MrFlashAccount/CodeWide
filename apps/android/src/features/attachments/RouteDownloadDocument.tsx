import { Pressable, StyleSheet, View } from "react-native";

import {
  useDocumentDownload,
  type DocumentPreviewRequest,
} from "../../rendering/DocumentPreviewHost";
import { useEvent } from "../../react/useEvent";
import { colors, spacing } from "../../theme";
import { AppText as Text } from "../../ui/Typography";

/** Keeps an explicitly opened binary file recoverable inside Router history. */
export function RouteDownloadDocument({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: DocumentPreviewRequest;
}): React.JSX.Element {
  const downloadDocument = useDocumentDownload();
  const download = useEvent(() => {
    void downloadDocument(request).catch(() => undefined);
  });
  return (
    <View style={styles.root}>
      <Text numberOfLines={2}>{request.name}</Text>
      <Pressable accessibilityRole="button" onPress={download}>
        <Text>Download</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onClose}>
        <Text>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
});
