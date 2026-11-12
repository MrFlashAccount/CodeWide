import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { useSelector } from "@legendapp/state/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, View, type TextStyle } from "react-native";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import { RichContentWidthProvider } from "../../../rendering/RichContentLayout";
import { RichMarkdownDocumentBlockView } from "../../../rendering/RichMarkdown";
import type { TerminalRun, TerminalStyle } from "../../../rendering/terminalAnsiText";
import type { DocumentContentRouteRequest } from "../../../services/content/contentRouteSession";
import { colors, iconSize } from "../../../theme";
import { TextShimmer } from "../../../ui/TextShimmer";
import { AppText as Text } from "../../../ui/Typography";
import { CopyButton } from "../turns/MessageActionRail";
import { styles } from "./ContentDocumentViewer.styles";
import type { ContentDocumentRow } from "./contentDocumentRows";
import {
  companionContentChunks,
  ContentDocumentReader,
  type ContentDocumentSnapshot,
  type ContentDocumentTail,
} from "./contentDocumentReader";
import { styles as frameStyles } from "./FullContentViewer.styles";

/** How far from the end, in viewport lengths, the next chunk starts loading. */
const LOAD_AHEAD_VIEWPORTS = 1;

/** The native terminal renderer's default colors and dim blend. */
const TERMINAL_FOREGROUND = "#d3d7de";
const TERMINAL_BACKGROUND = "#131416";
const DIM_OPACITY = 0.55;

/**
 * Shows one item's whole content in a virtualized list. Referenced fields are
 * read lazily: the first chunk at once, each next one as the reader nears the
 * end, appended in place with the last row shimmering meanwhile.
 */
export function ContentDocumentViewer({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: DocumentContentRouteRequest;
}): ReactElement {
  const reader = useConstant(
    () =>
      new ContentDocumentReader(request.parts, companionContentChunks(request.getTransferAccess)),
  );
  // Retention only: the reader started its first read when it was created.
  useEffect(() => reader.retain(), [reader]);
  const snapshot = useSelector(() => reader.snapshot$.get());
  const copyText = useEvent(() => reader.copyText() ?? "");
  const loadMore = useEvent(() => {
    reader.loadMore();
  });
  const retry = useEvent(() => {
    reader.retry();
  });
  return (
    <View style={frameStyles.fullContentViewer} testID="full-content-viewer">
      <ContentDocumentHeader
        copyText={snapshot.tail.kind === "complete" ? copyText : null}
        onClose={onClose}
        pending={snapshot.tail.kind === "loading" && snapshot.rows.length === 0}
        title={request.title}
      />
      <ContentDocumentList onEndReached={loadMore} onRetry={retry} snapshot={snapshot} />
    </View>
  );
}

/** The title (shimmering until the first rows arrive), whole-document copy and close. */
function ContentDocumentHeader({
  copyText,
  onClose,
  pending,
  title,
}: {
  /** Copies the whole document; null until every part is read. */
  readonly copyText: (() => string) | null;
  readonly onClose: () => void;
  readonly pending: boolean;
  readonly title: string;
}): ReactElement {
  const icon = (
    <Ionicons color={colors.textMuted} name="document-text-outline" size={iconSize.navigation} />
  );
  return (
    <View style={frameStyles.fullContentHeader}>
      <View style={frameStyles.fullContentHeaderIcon}>{icon}</View>
      <Text numberOfLines={1} shimmering={pending} style={styles.title}>
        {title}
      </Text>
      {copyText !== null && <CopyButton getText={copyText} />}
      <Pressable
        accessibilityLabel="Close full output"
        accessibilityRole="button"
        onPress={onClose}
        style={frameStyles.headerIcon}
      >
        <Ionicons color={colors.text} name="close" size={iconSize.navigation} />
      </Pressable>
    </View>
  );
}

/** The viewport: the rows read so far, then the tail. */
function ContentDocumentList({
  onEndReached,
  onRetry,
  snapshot,
}: {
  readonly onEndReached: () => void;
  readonly onRetry: () => void;
  readonly snapshot: ContentDocumentSnapshot;
}): ReactElement {
  const [width, setWidth] = useState<number | null>(null);
  const measure = useEvent((nextWidth: number) => {
    setWidth(Math.floor(nextWidth));
  });
  const loadingKey = snapshot.tail.kind === "loading" ? (snapshot.rows.at(-1)?.key ?? null) : null;
  const list = (
    <LegendList
      contentContainerStyle={styles.content}
      data={snapshot.rows}
      estimatedItemSize={160}
      // A row re-renders only for its item or `extraData`: the shimmer moves with the loading row.
      extraData={loadingKey}
      keyExtractor={rowKey}
      ListFooterComponent={<ContentTail onRetry={onRetry} tail={snapshot.tail} />}
      onEndReached={onEndReached}
      onEndReachedThreshold={LOAD_AHEAD_VIEWPORTS}
      recycleItems={false}
      renderItem={({ item }) => <ContentRow row={item} shimmering={item.key === loadingKey} />}
      style={styles.list}
      testID="content-document-list"
    />
  );
  return (
    <View
      onLayout={({ nativeEvent }) => {
        measure(nativeEvent.layout.width);
      }}
      style={frameStyles.fullContentViewport}
    >
      <RichContentWidthProvider width={width}>{list}</RichContentWidthProvider>
    </View>
  );
}

function rowKey(row: ContentDocumentRow): string {
  return row.key;
}

/** One row; the last one shimmers while the chunk that continues it loads. */
function ContentRow({
  row,
  shimmering,
}: {
  readonly row: ContentDocumentRow;
  readonly shimmering: boolean;
}): ReactElement {
  const target = useRef<View>(null);
  return (
    <View
      accessibilityState={{ busy: shimmering }}
      ref={target}
      style={row.kind === "markdown" ? styles.markdownRow : styles.row}
      testID={shimmering ? "content-document-loading-row" : undefined}
    >
      <ContentRowBody row={row} />
      <TextShimmer shimmering={shimmering} target={target} />
    </View>
  );
}

function ContentRowBody({ row }: { readonly row: ContentDocumentRow }): ReactElement {
  if (row.kind === "label") {
    return (
      <Text accessibilityRole="header" style={styles.label}>
        {row.text}
      </Text>
    );
  }
  if (row.kind === "markdown") {
    return <RichMarkdownDocumentBlockView block={row.block} />;
  }
  if (row.kind === "terminal") {
    return <TerminalText runs={row.runs} />;
  }
  return (
    <Text selectable style={styles.code}>
      {row.text}
    </Text>
  );
}

function TerminalText({ runs }: { readonly runs: readonly TerminalRun[] }): ReactElement {
  return (
    <Text selectable style={styles.code}>
      {runs.map((run) => (
        <Text key={run.start} style={terminalRunStyle(run.style)}>
          {run.text}
        </Text>
      ))}
    </Text>
  );
}

/** The native terminal renderer's mapping of one run's attributes. */
function terminalRunStyle(style: TerminalStyle): TextStyle {
  const colorsOfRun = terminalRunColors(style);
  return {
    backgroundColor: colorsOfRun.background,
    color: colorsOfRun.foreground,
    fontStyle: style.italic ? "italic" : "normal",
    fontWeight: style.bold ? "700" : undefined,
    opacity: style.dim ? DIM_OPACITY : 1,
    textDecorationLine: textDecoration(style),
  };
}

/** Hidden text takes its background's color. */
function terminalRunColors(style: TerminalStyle): {
  readonly background: string | undefined;
  readonly foreground: string;
} {
  const drawn = drawnColors(style);
  return {
    background: drawn.background ?? undefined,
    foreground: style.hidden ? (drawn.background ?? TERMINAL_BACKGROUND) : drawn.foreground,
  };
}

/** The colors a run draws in: inverse swaps them, defaults included. */
function drawnColors(style: TerminalStyle): {
  readonly background: string | null;
  readonly foreground: string;
} {
  if (style.inverse) {
    return {
      background: style.foreground ?? TERMINAL_FOREGROUND,
      foreground: style.background ?? TERMINAL_BACKGROUND,
    };
  }
  return { background: style.background, foreground: style.foreground ?? TERMINAL_FOREGROUND };
}

function textDecoration(style: TerminalStyle): NonNullable<TextStyle["textDecorationLine"]> {
  if (style.underline && style.strikethrough) {
    return "underline line-through";
  }
  if (style.underline) {
    return "underline";
  }
  return style.strikethrough ? "line-through" : "none";
}

/** The end of the list: nothing, or a failed read's error with its retry. */
function ContentTail({
  onRetry,
  tail,
}: {
  readonly onRetry: () => void;
  readonly tail: ContentDocumentTail;
}): ReactElement | null {
  if (tail.kind !== "failed") {
    return null;
  }
  return (
    <View style={styles.failure} testID="content-document-failure">
      <Text selectable style={styles.errorText}>
        {tail.error}
      </Text>
      <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
        <Ionicons color={colors.onPrimary} name="refresh" size={iconSize.action} />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}
