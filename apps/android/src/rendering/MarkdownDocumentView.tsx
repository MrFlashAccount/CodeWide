import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { spacing } from "../theme";
import type { ContentReviewTarget } from "./content-review";
import type { MarkdownLineTarget } from "./document-preview";
import {
  markdownDocumentBlocks,
  markdownDocumentTargetIndex,
  type MarkdownDocumentBlock,
} from "./markdown-document-blocks";
import { RichContentWidthProvider } from "./RichContentLayout";
import { RichMarkdownDocumentBlockView } from "./RichMarkdown";

/** Owns the document viewport; offscreen blocks do not create native text/layout work. */
export function MarkdownDocumentView({
  segments,
  target,
  reviewTarget,
  maxWidth,
  textScale,
  onScroll,
  footer,
}: {
  segments: readonly string[];
  target: MarkdownLineTarget | null;
  reviewTarget?: ContentReviewTarget;
  maxWidth?: number;
  textScale: number;
  onScroll(): void;
  footer: ReactNode;
}) {
  const list = useRef<LegendListRef>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const blocks = useMemo(() => markdownDocumentBlocks(segments), [segments]);
  const initialIndex = markdownDocumentTargetIndex(blocks, segments, target);
  const contentWidth = Math.max(
    1,
    Math.min(viewportWidth, maxWidth ?? viewportWidth) - spacing.md * 2,
  );
  const scroll = useEvent(onScroll);
  useLayoutEffect(() => {
    // Typography/width changes invalidate measured sizes, but retain the visible anchor.
    list.current?.clearCaches({ mode: "sizes" });
  }, [contentWidth, textScale]);
  return (
    <View
      style={styles.root}
      onLayout={({ nativeEvent }) => setViewportWidth(Math.floor(nativeEvent.layout.width))}
    >
      {viewportWidth > 0 && (
        <RichContentWidthProvider width={contentWidth}>
          <LegendList
            ref={list}
            data={blocks}
            keyExtractor={documentBlockKey}
            renderItem={({ item }) => (
              <View style={[styles.block, maxWidth === undefined ? null : { maxWidth }]}>
                <RichMarkdownDocumentBlockView
                  block={item}
                  {...(reviewTarget === undefined ? {} : { reviewTarget })}
                />
              </View>
            )}
            initialScrollIndex={initialIndex}
            estimatedItemSize={240}
            drawDistance={300}
            recycleItems={false}
            onScroll={scroll}
            scrollEventThrottle={96}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={
              <View style={[styles.block, maxWidth === undefined ? null : { maxWidth }]}>
                {footer}
              </View>
            }
            style={styles.root}
          />
        </RichContentWidthProvider>
      )}
    </View>
  );
}

function documentBlockKey(block: MarkdownDocumentBlock): string {
  return block.key;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
  block: {
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
});
