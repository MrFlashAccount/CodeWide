import { StyleSheet, View } from "react-native";

import { colors } from "../theme";

export function InternalBrowser({ url }: {
  url: string;
  headers?: Record<string, string>;
  header?: { title: string; closeLabel: string; onClose(): void; closeIcon?: "arrow-back" | "close"; status?: string };
  originWhitelist?: string[];
  onHttpError?(statusCode: number): void;
  onError?(description: string): void;
}) {
  return <View accessibilityLabel={`Internal browser: ${url}`} style={styles.root} />;
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: colors.background } });
