import { ScrollView, StyleSheet, View } from "react-native";

import { NativeCodeBlockHost } from "../../presentation/nativeCodeBlockHost";
import { colors, spacing, typeScale } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import {
  nativeCodeHeight,
  nativeCodePreview,
  normalizeNativeCodeLanguage,
  stripTerminalControlSequences,
  type NativeCodeVariant,
} from "./nativeCodeBlockModel";

interface NativeCodeBlockProps {
  language: string;
  maxHeight?: number;
  maxVisibleLines?: number;
  truncate?: boolean;
  value: string;
  variant?: NativeCodeVariant;
}

export function NativeCodeBlock(props: NativeCodeBlockProps): React.JSX.Element {
  const { language, maxHeight, maxVisibleLines, truncate = true, value, variant = "code" } = props;
  const preview = truncate
    ? nativeCodePreview(value)
    : { originalLines: value === "" ? 1 : value.split("\n").length, truncated: false, value };
  const height = nativeCodeHeight(preview.value, maxHeight, maxVisibleLines);
  const normalizedLanguage = normalizeNativeCodeLanguage(language, variant);
  if (NativeCodeBlockHost === null) {
    const fallback =
      variant === "terminal" ? stripTerminalControlSequences(preview.value) : preview.value;
    return (
      <ScrollView
        contentContainerStyle={styles.fallbackContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.viewport, { height }]}
      >
        <Text selectable style={styles.code}>
          {fallback}
        </Text>
      </ScrollView>
    );
  }
  return (
    <View style={styles.container}>
      <NativeCodeBlockHost
        code={preview.value}
        language={normalizedLanguage}
        maxLines={maxVisibleLines ?? 0}
        style={[styles.native, { height }]}
        variant={variant}
      />
      {preview.truncated ? (
        <Text style={styles.truncated}>
          Showing {preview.value.length.toLocaleString()} characters from{" "}
          {preview.originalLines.toLocaleString()} lines
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  code: { color: "#c6d0da", ...typeScale.code },
  container: { gap: spacing.xxs, maxWidth: "100%", minWidth: 0, width: "100%" },
  fallbackContent: { flexGrow: 0, paddingVertical: spacing.xxs },
  native: { maxWidth: "100%", minWidth: 0, width: "100%" },
  truncated: { color: colors.textDim, ...typeScale.caption },
  viewport: {
    backgroundColor: colors.code,
    flexGrow: 0,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
});
