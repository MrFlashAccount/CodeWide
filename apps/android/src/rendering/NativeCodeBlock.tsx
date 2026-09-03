import { ScrollView, StyleSheet, View } from "react-native";

import { NativeCodeBlockHost } from "../presentation/nativeCodeBlockHost";
import { colors } from "../theme";
import { AppText as Text } from "../ui/Typography";
import {
  nativeCodeHeight,
  nativeCodePreview,
  normalizeNativeCodeLanguage,
  stripTerminalControlSequences,
  type NativeCodeVariant,
} from "./native-code-block";
import { useRichContentWidth } from "./RichContentLayout";

export function NativeCodeBlock({
  value,
  language,
  variant = "code",
  maxHeight,
  maxVisibleLines,
  fillAvailableWidth = false,
  truncate = true,
}: {
  value: string;
  language: string;
  variant?: NativeCodeVariant;
  maxHeight?: number;
  maxVisibleLines?: number;
  fillAvailableWidth?: boolean;
  truncate?: boolean;
}) {
  const availableWidth = useRichContentWidth();
  const preview = truncate
    ? nativeCodePreview(value)
    : { value, truncated: false, originalLines: value === "" ? 1 : value.split("\n").length };
  const normalizedLanguage = normalizeNativeCodeLanguage(language, variant);
  const height = nativeCodeHeight(preview.value, maxHeight, maxVisibleLines);
  if (NativeCodeBlockHost === null) {
    const fallbackValue =
      variant === "terminal" ? stripTerminalControlSequences(preview.value) : preview.value;
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.fallbackViewport, { height }]}
        contentContainerStyle={styles.fallbackContent}
      >
        <Text selectable style={styles.fallbackText}>
          {fallbackValue}
        </Text>
      </ScrollView>
    );
  }
  return (
    <View
      style={[
        styles.container,
        fillAvailableWidth && availableWidth !== null && availableWidth > 0
          ? { width: availableWidth }
          : null,
      ]}
    >
      <NativeCodeBlockHost
        code={preview.value}
        language={normalizedLanguage}
        variant={variant}
        maxLines={maxVisibleLines ?? 0}
        style={[styles.nativeView, { height }]}
      />
      {preview.truncated && (
        <Text style={styles.truncated}>
          Showing {preview.value.length.toLocaleString()} characters from{" "}
          {preview.originalLines.toLocaleString()} lines
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: "100%", minWidth: 0, maxWidth: "100%", gap: 3 },
  nativeView: { width: "100%", minWidth: 0, maxWidth: "100%" },
  fallbackViewport: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    flexGrow: 0,
    backgroundColor: colors.code,
  },
  fallbackContent: { flexGrow: 0, paddingVertical: 4 },
  fallbackText: { color: "#c6d0da", fontFamily: "monospace", fontSize: 11, lineHeight: 16 },
  truncated: { color: colors.textDim, fontSize: 9, lineHeight: 12 },
});
