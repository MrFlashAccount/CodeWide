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
  embeddedInParentScroll = true,
  fillAvailableWidth = false,
  language,
  maxHeight,
  maxVisibleLines,
  truncate = true,
  value,
  variant = "code",
}: {
  embeddedInParentScroll?: boolean;
  fillAvailableWidth?: boolean;
  language: string;
  maxHeight?: number;
  maxVisibleLines?: number;
  truncate?: boolean;
  value: string;
  variant?: NativeCodeVariant;
}) {
  const availableWidth = useRichContentWidth();
  const searchQuery = useContext(SearchHighlightQuery);
  const preview = truncate
    ? nativeCodePreview(value)
    : { originalLines: value === "" ? 1 : value.split("\n").length, truncated: false, value };
  const normalizedLanguage = normalizeNativeCodeLanguage(language, variant);
  const height = nativeCodeHeight(preview.value, maxHeight, maxVisibleLines);
  if (NativeCodeBlockHost === null) {
    const fallbackValue =
      variant === "terminal" ? stripTerminalControlSequences(preview.value) : preview.value;
    return (
      <ScrollView
        contentContainerStyle={styles.fallbackContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.fallbackViewport, { height }]}
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
        embeddedInParentScroll={embeddedInParentScroll}
        language={normalizedLanguage}
        maxLines={maxVisibleLines ?? 0}
        searchQuery={searchQuery}
        style={[styles.nativeView, { height }]}
        variant={variant}
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
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
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
  fallbackViewport: {
    backgroundColor: colors.code,
    flexGrow: 0,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  nativeView: {
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  truncated: {
    color: colors.textDim,
    ...typeScale.caption,
  },
});
