import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
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
  footer,
  maxWidth,
  onScroll,
  reviewTarget,
  segments,
  target,
  textScale,
}: {
  footer: ReactNode;
  maxWidth?: number;
  onScroll: () => void;
  reviewTarget?: ContentReviewTarget;
  segments: readonly string[];
  target: MarkdownLineTarget | null;
  textScale: number;
}) {
  const list = useRef<LegendListRef>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const blocks = markdownDocumentBlocks(segments);
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
      onLayout={({ nativeEvent }) => {
        setViewportWidth(Math.floor(nativeEvent.layout.width));
      }}
      style={styles.root}
    >
      {viewportWidth > 0 && (
        <RichContentWidthProvider width={contentWidth}>
          <LegendList
            data={blocks}
            drawDistance={300}
            estimatedItemSize={240}
            initialScrollIndex={initialIndex}
            keyboardShouldPersistTaps="handled"
            keyExtractor={documentBlockKey}
            ListFooterComponent={
              <View style={[styles.block, maxWidth === undefined ? null : { maxWidth }]}>
                {footer}
              </View>
            }
            onScroll={scroll}
            recycleItems={false}
            ref={list}
            renderItem={({ item }) => (
              <View style={[styles.block, maxWidth === undefined ? null : { maxWidth }]}>
                <RichMarkdownDocumentBlockView
                  block={item}
                  {...(reviewTarget === undefined ? {} : { reviewTarget })}
                />
              </View>
            )}
            scrollEventThrottle={96}
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
  block: {
    alignSelf: "center",
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    width: "100%",
  },
  root: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
});
