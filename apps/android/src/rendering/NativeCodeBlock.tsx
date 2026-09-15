import { ScrollView, StyleSheet, View } from "react-native";
import { useContext } from "react";
import { HighlightSearchText, SearchHighlightQuery } from "./SearchMessageFocus";

import { NativeCodeBlockHost } from "../presentation/nativeCodeBlockHost";
import { colors, spacing, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import {
  nativeCodeHeight,
  NATIVE_CODE_FONT_SIZE,
  NATIVE_CODE_LINE_HEIGHT,
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
  embeddedInParentScroll = true,
  truncate = true,
}: {
  value: string;
  language: string;
  variant?: NativeCodeVariant;
  maxHeight?: number;
  maxVisibleLines?: number;
  fillAvailableWidth?: boolean;
  embeddedInParentScroll?: boolean;
  truncate?: boolean;
}) {
  const availableWidth = useRichContentWidth();
  const searchQuery = useContext(SearchHighlightQuery);
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
          <HighlightSearchText text={fallbackValue} />
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
        searchQuery={searchQuery}
        language={normalizedLanguage}
        variant={variant}
        maxLines={maxVisibleLines ?? 0}
        embeddedInParentScroll={embeddedInParentScroll}
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
  container: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    gap: spacing.xxs,
  },
  nativeView: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
  },
  fallbackViewport: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    flexGrow: 0,
    backgroundColor: colors.code,
  },
  fallbackContent: {
    flexGrow: 0,
    paddingVertical: spacing.xxs,
  },
  fallbackText: {
    color: colors.textMuted,
    ...typeScale.code,
    fontSize: NATIVE_CODE_FONT_SIZE,
    lineHeight: NATIVE_CODE_LINE_HEIGHT,
  },
  truncated: {
    color: colors.textDim,
    ...typeScale.caption,
  },
});
