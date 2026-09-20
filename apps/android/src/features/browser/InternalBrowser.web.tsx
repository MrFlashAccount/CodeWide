import { StyleSheet, View } from "react-native";

import { colors } from "../../theme";
import type { BrowserFeedbackCapability } from "./feedback";

export function InternalBrowser({
  url,
}: {
  feedback?: BrowserFeedbackCapability;
  header?: {
    closeIcon?: "arrow-back" | "close";
    closeLabel: string;
    onClose: () => void;
    status?: string;
    title: string;
  };
  headers?: Readonly<Record<string, string>>;
  onError?: (description: string) => void;
  onHttpError?: (statusCode: number) => void;
  originWhitelist?: string[];
  url: string;
}) {
  return <View accessibilityLabel={`Internal browser: ${url}`} style={styles.root} />;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
