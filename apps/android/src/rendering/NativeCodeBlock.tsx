import { ScrollView, StyleSheet, View } from "react-native";
import { useContext, type ReactElement } from "react";
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
  wrapLines = false,
}: {
  embeddedInParentScroll?: boolean;
  fillAvailableWidth?: boolean;
  language: string;
  maxHeight?: number;
  maxVisibleLines?: number;
  truncate?: boolean;
  value: string;
  variant?: NativeCodeVariant;
  /** Wraps long lines instead of scrolling them sideways; wrapped rows fill `maxHeight`. */
  wrapLines?: boolean;
}) {
  const availableWidth = useRichContentWidth();
  const searchQuery = useContext(SearchHighlightQuery);
  const preview = truncate
    ? nativeCodePreview(value)
    : { originalLines: value === "" ? 1 : value.split("\n").length, truncated: false, value };
  const normalizedLanguage = normalizeNativeCodeLanguage(language, variant);
  // Wrapped rows outnumber the source's lines, so a wrapping block takes the
  // whole height it is given and scrolls inside it.
  const height =
    wrapLines && maxHeight !== undefined
      ? maxHeight
      : nativeCodeHeight(preview.value, maxHeight, maxVisibleLines);
  if (NativeCodeBlockHost === null) {
    const fallbackValue =
      variant === "terminal" ? stripTerminalControlSequences(preview.value) : preview.value;
    return <NativeCodeBlockFallback height={height} value={fallbackValue} wrapLines={wrapLines} />;
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
        wrapLines={wrapLines}
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

function NativeCodeBlockFallback({
  height,
  value,
  wrapLines,
}: {
  readonly height: number;
  readonly value: string;
  readonly wrapLines: boolean;
}): ReactElement {
  return (
    <ScrollView
      nestedScrollEnabled
      showsVerticalScrollIndicator
      style={[styles.fallbackViewport, { height }]}
    >
      {wrapLines ? (
        <Text selectable style={[styles.fallbackText, styles.fallbackContent]}>
          <HighlightSearchText text={value} />
        </Text>
      ) : (
        <NativeCodeBlockFallbackRow value={value} />
      )}
    </ScrollView>
  );
}

function NativeCodeBlockFallbackRow({ value }: { readonly value: string }): ReactElement {
  return (
    <ScrollView
      contentContainerStyle={styles.fallbackContent}
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator
    >
      <Text selectable style={styles.fallbackText}>
        <HighlightSearchText text={value} />
      </Text>
    </ScrollView>
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
