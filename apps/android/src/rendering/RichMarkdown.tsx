import type { Nodes, PhrasingContent, RootContent, Table, TableCell } from "mdast";
import { messageMarkupNodeHtml } from "@codewide/rendering-core/markup";
import { ArtifactImageReferences } from "./ArtifactImageReferences";
import {
  isSafeLink,
  plainRichMarkdownRootText,
  richMarkdownBlockIndexAtLine,
} from "@codewide/rendering-core";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import {
  createContext,
  type ComponentProps,
  type ReactNode,
  useContext,
  useId,
  useRef,
  useState,
} from "react";
import {
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";

import { colors, radii, typeScale, spacing, typeWeight, iconSize } from "../theme";
import { usePerformanceExperiment } from "../data/performance-experiments";
import { useEvent } from "../react/useEvent";
import { AppText } from "../ui/Typography";
import { useAppDialog } from "../ui/AppDialog";
import { isRemoteFileHref, remoteFileKind } from "./document-preview";
import { parseDiagnosticRichMarkdown } from "./diagnostic-markdown";
import { safeImageUri } from "./image-source";
import { recordDecodedImage, wasImageDecoded } from "./imageDecodeCache";
import {
  useImagePreview,
  useImagePreviewGroup,
  useRegisterImagePreviewItem,
} from "./ImagePreviewHost";
import { useMarkdownLocalLinkHandler } from "./MarkdownLinkHandler";
import { markdownTableLayout } from "./markdown-table-layout";
import { useTableViewport } from "./useTableViewport";
import { markdownNodeIdentity } from "./markdownNodeIdentity";
import { collectMarkdownImageOrder, type MarkdownImageNode } from "./markdown-image-order";
import type { MarkdownDocumentBlock } from "./markdown-document-blocks";
import { AsciiDiagram, MermaidDiagram } from "./MermaidDiagram";
import { NativeCodeBlock } from "./NativeCodeBlock";
import { CodeBlockHeader } from "./CodeBlockHeader";
import { NativeRevealSurface } from "./NativeRevealSurface";
import { InlineMediaFrame, INLINE_MEDIA_PREVIEW_HEIGHT } from "./InlineMediaFrame";
import type { MarkupImageDimensions } from "./markup-image-dimensions";
import { useContentReview, useContentReviewHighlights } from "./ContentReviewHost";
import type { ContentReviewTarget } from "./content-review";
import { ReviewableText } from "./ReviewableText";
import { looksLikeAsciiDiagram } from "./ascii-diagram";
import { RichContentWidthProvider, useRichContentWidth } from "./RichContentLayout";
import { usePrivateImageUri } from "./use-private-image-uri";
import { NativeMarkup } from "./NativeMarkup";
import { HighlightSearchText } from "./SearchMessageFocus";

const HorizontalScrollView = Platform.OS === "android" ? GestureScrollView : ScrollView;
const RichMarkdownTextScaleContext = createContext(1);
const RichMarkdownReviewContext = createContext<{
  pathPrefix: string;
  target: ContentReviewTarget;
} | null>(null);
const RichMarkdownRevealContext = createContext(false);
const EMPTY_RICH_EXTENSIONS: Record<string, RichExtensionRenderer> = {};

export function RichMarkdownTextScaleProvider({
  children,
  scale,
}: {
  children: ReactNode;
  scale: number;
}) {
  return (
    <RichMarkdownTextScaleContext.Provider value={Math.max(0.8, Math.min(1.4, scale))}>
      {children}
    </RichMarkdownTextScaleContext.Provider>
  );
}

/** Applies viewer-local typography without mutating global chat Markdown. */
// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
function Text({
  reviewBlockPath,
  reviewOffset = 0,
  style,
  ...props
}: ComponentProps<typeof AppText> & {
  reviewBlockPath?: string;
  reviewOffset?: number;
}) {
  const scale = useContext(RichMarkdownTextScaleContext);
  const review = useContext(RichMarkdownReviewContext);
  const beginReview = useContentReview();
  const blockPath =
    review === null || reviewBlockPath === undefined
      ? null
      : `${review.pathPrefix}/${reviewBlockPath}`;
  const reviewHighlights = useContentReviewHighlights(
    review?.target.id ?? "",
    blockPath ?? "",
    reviewOffset,
  );
  const flattened = StyleSheet.flatten(style);
  const fontSize = typeof flattened.fontSize === "number" ? flattened.fontSize * scale : undefined;
  const lineHeight =
    typeof flattened.lineHeight === "number" ? flattened.lineHeight * scale : undefined;
  const resolvedStyle =
    scale === 1
      ? style
      : [
          style,
          {
            ...(fontSize === undefined ? {} : { fontSize }),
            ...(lineHeight === undefined ? {} : { lineHeight }),
          },
        ];
  if (review !== null && blockPath !== null) {
    return (
      <ReviewableText
        {...props}
        onReviewSelection={(selection) => {
          beginReview({
            blockPath,
            end: reviewOffset + selection.end,
            kind: "text",
            quote: selection.text,
            start: reviewOffset + selection.start,
            target: review.target,
          });
        }}
        reviewHighlights={reviewHighlights}
        style={resolvedStyle}
      />
    );
  }
  return <AppText {...props} style={resolvedStyle} />;
}

function InsetRichContentWidth({ children, inset }: { children: ReactNode; inset: number }) {
  const availableWidth = useRichContentWidth();
  const nestedWidth = availableWidth === null ? null : Math.max(1, availableWidth - inset);
  return <RichContentWidthProvider width={nestedWidth}>{children}</RichContentWidthProvider>;
}

export type RichExtensionRenderer = (value: string, meta: string | null) => ReactNode;

// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
export function RichMarkdown({
  streaming = false,
  animateStreaming = streaming,
  extensions = EMPTY_RICH_EXTENSIONS,
  maxLines,
  onTargetLayout,
  reviewPathPrefix = "segment-0",
  reviewTarget,
  source,
  targetLine,
}: {
  animateStreaming?: boolean;
  extensions?: Record<string, RichExtensionRenderer>;
  maxLines?: number;
  onTargetLayout?: (y: number) => void;
  reviewPathPrefix?: string;
  reviewTarget?: ContentReviewTarget;
  source: string;
  streaming?: boolean;
  targetLine?: number;
}) {
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  if (plainText) {
    return (
      <RichMarkdownReviewContext.Provider
        value={
          reviewTarget === undefined ? null : { pathPrefix: reviewPathPrefix, target: reviewTarget }
        }
      >
        <Text
          reviewBlockPath="plain"
          selectable
          {...(maxLines === undefined
            ? {}
            : { ellipsizeMode: "tail" as const, numberOfLines: maxLines })}
          style={styles.paragraph}
        >
          {source}
        </Text>
      </RichMarkdownReviewContext.Provider>
    );
  }
  // Streaming revisions belong to this mounted view, not the completed-text cache.
  const parsed = parseDiagnosticRichMarkdown(source, !streaming);
  const imageOrder = collectMarkdownImageOrder(parsed.root);
  if (maxLines !== undefined) {
    return (
      <RichMarkdownReviewContext.Provider
        value={
          reviewTarget === undefined ? null : { pathPrefix: reviewPathPrefix, target: reviewTarget }
        }
      >
        <Text
          ellipsizeMode="tail"
          numberOfLines={maxLines}
          reviewBlockPath="truncated"
          selectable
          style={styles.paragraph}
        >
          {plainRichMarkdownRootText(parsed.root)}
        </Text>
      </RichMarkdownReviewContext.Provider>
    );
  }
  const targetBlockIndex =
    targetLine === undefined ? null : richMarkdownBlockIndexAtLine(source, targetLine);
  return (
    <RichMarkdownRevealContext.Provider value={animateStreaming}>
      <RichMarkdownReviewContext.Provider
        value={
          reviewTarget === undefined ? null : { pathPrefix: reviewPathPrefix, target: reviewTarget }
        }
      >
        <View style={styles.document}>
          {parsed.root.children.map((node, index) => {
            const path = `${node.type}-${String(index)}`;
            const key = markdownNodeKey(node);
            const block = (
              <BlockNode extensions={extensions} imageOrder={imageOrder} node={node} path={path} />
            );
            return index === targetBlockIndex && onTargetLayout !== undefined ? (
              <View
                collapsable={false}
                key={key}
                onLayout={({ nativeEvent }) => {
                  onTargetLayout(nativeEvent.layout.y);
                }}
              >
                {block}
              </View>
            ) : (
              <BlockNode
                extensions={extensions}
                imageOrder={imageOrder}
                key={key}
                node={node}
                path={path}
              />
            );
          })}
          {parsed.truncated && (
            <View style={styles.truncated}>
              <Text style={styles.secondary}>
                Large message preview · {parsed.originalLength.toLocaleString()} characters
              </Text>
            </View>
          )}
        </View>
      </RichMarkdownReviewContext.Provider>
    </RichMarkdownRevealContext.Provider>
  );
}

/** Renders one document viewport item with the same review address as the full renderer. */
export function RichMarkdownDocumentBlockView({
  animateStreaming = false,
  block,
  reviewTarget,
}: {
  animateStreaming?: boolean;
  block: MarkdownDocumentBlock;
  reviewTarget?: ContentReviewTarget;
}) {
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  return (
    <RichMarkdownRevealContext.Provider value={animateStreaming}>
      <RichMarkdownReviewContext.Provider
        value={
          reviewTarget === undefined
            ? null
            : { pathPrefix: block.reviewPathPrefix, target: reviewTarget }
        }
      >
        {plainText ? (
          <Text reviewBlockPath={block.path} selectable style={styles.paragraph}>
            {plainRichMarkdownRootText(block.node)}
          </Text>
        ) : (
          <BlockNode
            extensions={{}}
            imageOrder={block.imageOrder}
            node={block.node}
            path={block.path}
          />
        )}
      </RichMarkdownReviewContext.Provider>
    </RichMarkdownRevealContext.Provider>
  );
}

// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
function BlockNode({
  extensions,
  imageOrder,
  node,
  path,
}: {
  extensions: Record<string, RichExtensionRenderer>;
  imageOrder: WeakMap<MarkdownImageNode, number>;
  node: RootContent;
  path: string;
}) {
  const review = useContext(RichMarkdownReviewContext);
  const animateStreaming = useContext(RichMarkdownRevealContext);
  switch (node.type) {
    case "paragraph":
      if (node.children.length === 1 && node.children[0]?.type === "image") {
        const order = imageOrder.get(node.children[0]);
        return (
          <MarkdownImage
            alt={node.children[0].alt ?? "Image"}
            reveal={animateStreaming}
            url={node.children[0].url}
            {...(order === undefined ? {} : { order })}
          />
        );
      }
      if (
        node.children.length === 1 &&
        node.children[0]?.type === "link" &&
        node.children[0].children.length === 1 &&
        node.children[0].children[0]?.type === "image"
      ) {
        const image = node.children[0].children[0];
        const order = imageOrder.get(image);
        return (
          <MarkdownImage
            alt={image.alt ?? "Image"}
            reveal={animateStreaming}
            target={node.children[0].url}
            url={image.url}
            {...(order === undefined ? {} : { order })}
          />
        );
      }
      return (
        <Text reviewBlockPath={path} selectable style={styles.paragraph}>
          {inline(node.children)}
        </Text>
      );
    case "heading": {
      const style = [styles.heading, headingStyle(node.depth)];
      return (
        <Text reviewBlockPath={path} selectable style={style}>
          {inline(node.children)}
        </Text>
      );
    }
    case "blockquote": {
      const alert = githubAlert(node);
      if (alert !== null) {
        return (
          <View style={styles.alert}>
            <View style={styles.alertHeader}>
              <Ionicons color={alert.color} name={alert.icon} size={iconSize.inline} />
              <Text style={[styles.alertTitle, { color: alert.color }]}>{alert.label}</Text>
            </View>
            <View style={styles.alertBody}>
              <InsetRichContentWidth inset={18}>
                {alert.children.map((child, index) => (
                  <BlockNode
                    extensions={extensions}
                    imageOrder={imageOrder}
                    key={markdownNodeKey(child)}
                    node={child}
                    path={`${path}/alert-${String(index)}`}
                  />
                ))}
              </InsetRichContentWidth>
            </View>
          </View>
        );
      }
      return (
        <View style={styles.blockquote}>
          <InsetRichContentWidth inset={10}>
            {node.children.map((child, index) => (
              <BlockNode
                extensions={extensions}
                imageOrder={imageOrder}
                key={markdownNodeKey(child)}
                node={child}
                path={`${path}/quote-${String(index)}`}
              />
            ))}
          </InsetRichContentWidth>
        </View>
      );
    }
    case "list":
      return (
        <View style={styles.list}>
          {node.children.map((item, index) => (
            <View key={markdownNodeKey(item)} style={styles.listRow}>
              {typeof item.checked === "boolean" ? (
                <View
                  accessibilityLabel={item.checked ? "Completed task" : "Open task"}
                  style={styles.taskMarker}
                >
                  <Ionicons
                    color={item.checked ? colors.green : colors.textMuted}
                    name={item.checked ? "checkbox" : "square-outline"}
                    size={iconSize.inline}
                  />
                </View>
              ) : (
                <Text style={styles.listMarker}>
                  {node.ordered === true ? `${String((node.start ?? 1) + index)}.` : "•"}
                </Text>
              )}
              <View style={styles.listBody}>
                <InsetRichContentWidth inset={25}>
                  {item.children.map((child, childIndex) => (
                    <BlockNode
                      extensions={extensions}
                      imageOrder={imageOrder}
                      key={markdownNodeKey(child)}
                      node={child}
                      path={`${path}/item-${String(index)}-${String(childIndex)}`}
                    />
                  ))}
                </InsetRichContentWidth>
              </View>
            </View>
          ))}
        </View>
      );
    case "code": {
      const language = node.lang ?? "text";
      if (language.toLocaleLowerCase() === "mermaid") {
        return (
          <View style={styles.wideBlock}>
            <MermaidDiagram
              reveal={animateStreaming}
              source={node.value}
              {...(review === null
                ? {}
                : { diagramId: `${review.pathPrefix}/${path}`, reviewTarget: review.target })}
            />
          </View>
        );
      }
      if (looksLikeAsciiDiagram(node.value, node.lang)) {
        return (
          <View style={styles.wideBlock}>
            <AsciiDiagram source={node.value} />
          </View>
        );
      }
      if (language.startsWith("codex-")) {
        const extension = extensions[language.slice("codex-".length)];
        if (extension !== undefined) {
          return <>{extension(node.value, node.meta ?? null)}</>;
        }
      }
      return <CopyableCodeBlock language={language} value={node.value} />;
    }
    case "table":
      return <MarkdownTable path={path} table={node} />;
    case "thematicBreak":
      return <View style={styles.rule} />;
    case "html":
      return (
        <MarkupBlock extensions={extensions} imageOrder={imageOrder} node={node} path={path} />
      );
    case "footnoteDefinition":
      return (
        <View style={styles.footnote}>
          <Text selectable style={styles.footnoteMarker}>
            [{node.identifier}]
          </Text>
          <View style={styles.footnoteBody}>
            {node.children.map((child, index) => (
              <BlockNode
                extensions={extensions}
                imageOrder={imageOrder}
                key={markdownNodeKey(child)}
                node={child}
                path={`${path}/footnote-${String(index)}`}
              />
            ))}
          </View>
        </View>
      );
    case "definition":
    case "yaml":
      return null;
    case "break":
    case "delete":
    case "emphasis":
    case "footnoteReference":
    case "image":
    case "imageReference":
    case "inlineCode":
    case "link":
    case "linkReference":
    case "listItem":
    case "strong":
    case "tableCell":
    case "tableRow":
    case "text":
      return (
        <Text reviewBlockPath={path} selectable style={styles.secondary}>
          {fallbackText(node)}
        </Text>
      );
    default:
      return null;
  }
}

function MarkupBlock({
  extensions,
  imageOrder,
  node,
  path,
}: {
  extensions: Record<string, RichExtensionRenderer>;
  imageOrder: WeakMap<MarkdownImageNode, number>;
  node: Extract<RootContent, { type: "html" }>;
  path: string;
}) {
  const animateStreaming = useContext(RichMarkdownRevealContext);
  const html = messageMarkupNodeHtml(node);
  const renderCode = useEvent((value: string, language: string, childPath: string) => (
    <BlockNode
      extensions={extensions}
      imageOrder={imageOrder}
      node={{ lang: language, type: "code", value }}
      path={`${path}/${childPath}`}
    />
  ));
  const renderImage = useEvent((url: string, alt: string, dimensions?: MarkupImageDimensions) => (
    <MarkdownImage
      alt={alt}
      reveal={animateStreaming}
      url={url}
      {...(dimensions === undefined ? {} : { dimensions })}
    />
  ));
  const renderLink = useEvent((url: string, children: ReactNode) => (
    <MarkdownLink url={url}>{children}</MarkdownLink>
  ));
  if (html === null) {
    return (
      <CopyableInline style={styles.rawHtml} value={node.value}>
        {node.value}
      </CopyableInline>
    );
  }
  return <NativeMarkup code={renderCode} html={html} image={renderImage} link={renderLink} />;
}

function CopyableCodeBlock({ language, value }: { language: string; value: string }) {
  const [copied, copy] = useCopyFeedback(value);
  const scale = useContext(RichMarkdownTextScaleContext);
  return (
    <Pressable
      accessibilityLabel={`Copy ${language} code block`}
      accessibilityRole="button"
      onPress={copy}
      style={({ pressed }) => [styles.codeContainer, pressed && styles.copyPressed]}
    >
      <CodeBlockHeader copied={copied} language={language} scale={scale} />
      <NativeCodeBlock language={language} value={value} />
    </Pressable>
  );
}

function CopyableInline({
  children,
  onLongPress,
  style,
  value,
}: {
  children: ReactNode;
  onLongPress?: () => void;
  style?: StyleProp<TextStyle>;
  value: string;
}) {
  const [copied, copy] = useCopyFeedback(value);
  return (
    <Text
      accessibilityHint={
        onLongPress === undefined
          ? "Copies to clipboard"
          : "Copies to clipboard; long press opens the link"
      }
      accessibilityRole="button"
      onPress={copy}
      {...(onLongPress === undefined ? {} : { onLongPress })}
      style={[style, copied && styles.copyHintDone]}
    >
      {children}
    </Text>
  );
}

// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
function MarkdownLink({ children, url }: { children: ReactNode; url: string }) {
  const dialog = useAppDialog();
  const openLocalLink = useMarkdownLocalLinkHandler();
  const external = isSafeLink(url);
  const localKind =
    !external && openLocalLink !== null && isRemoteFileHref(url) ? remoteFileKind(url, url) : null;
  const local = localKind !== null;
  if (!external && !local) {
    return <Text style={styles.secondary}>{children}</Text>;
  }
  return (
    <Text
      accessibilityHint="Opens the link"
      accessibilityRole="link"
      onPress={() => {
        if (openLocalLink?.(url) === true) {
          return;
        }
        if (external) {
          Linking.openURL(url).catch((error: unknown) => {
            dialog.alert(
              "Could not open link",
              error instanceof Error ? error.message : "Could not open link",
            );
          });
        }
      }}
      style={styles.link}
    >
      {children}
      {(external || localKind === "download") && " "}
      {external && <Ionicons color={colors.accent} name="open-outline" size={iconSize.indicator} />}
      {localKind === "download" && (
        <Ionicons color={colors.accent} name="download-outline" size={iconSize.indicator} />
      )}
    </Text>
  );
}

function useCopyFeedback(value: string): [boolean, () => void] {
  const dialog = useAppDialog();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = () => {
    Clipboard.setStringAsync(value).then(
      () => {
        setCopied(true);
      },
      (error: unknown) => {
        dialog.alert("Copy failed", error instanceof Error ? error.message : "Could not copy");
      },
    );
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, 900);
  };
  return [copied, copy];
}

// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
function MarkdownImage({
  alt,
  dimensions,
  order,
  reveal = false,
  url,
  target = url,
}: {
  alt: string;
  dimensions?: MarkupImageDimensions;
  order?: number;
  reveal?: boolean;
  target?: string;
  url: string;
}) {
  const inGallery = useContext(ArtifactImageReferences)?.has(url) === true;
  const openImagePreview = useImagePreview();
  const openLocalLink = useMarkdownLocalLinkHandler();
  const groupId = useImagePreviewGroup();
  const previewId = useId();
  const imageUri = inGallery ? null : safeImageUri(url);
  const privateImage = usePrivateImageUri(imageUri);
  const [loadedUri, setLoadedUri] = useState<string | null>(null);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const availableWidth = useRichContentWidth();
  const imageHeight =
    dimensions !== undefined && availableWidth !== null
      ? Math.max(48, Math.min(440, (availableWidth * dimensions.height) / dimensions.width))
      : INLINE_MEDIA_PREVIEW_HEIGHT;
  const imageStyle = [styles.markdownImage, { height: imageHeight }];
  const safeTarget = isSafeLink(target) ? target : null;
  const previewItem = {
    detail: privateImage.detail,
    id: groupId === null ? previewId : `${groupId}:${url}:${alt}`,
    label: alt,
    link: safeTarget,
    reference: url,
    source: privateImage.source ?? { uri: imageUri ?? "" },
    ...(order === undefined ? {} : { order }),
  };
  useRegisterImagePreviewItem(inGallery ? null : groupId, previewItem);
  if (inGallery) {
    return null;
  }
  if (
    imageUri === null &&
    openLocalLink !== null &&
    isRemoteFileHref(url) &&
    remoteFileKind(alt, url) === "image"
  ) {
    return (
      <Pressable
        accessibilityLabel={`Open ${alt}`}
        accessibilityRole="imagebutton"
        onPress={() => {
          openLocalLink(url);
        }}
        style={styles.localImageLink}
      >
        <Ionicons color={colors.accent} name="image-outline" size={iconSize.inline} />
        <Text ellipsizeMode="middle" numberOfLines={1} style={styles.link}>
          {alt}
        </Text>
      </Pressable>
    );
  }
  if (imageUri === null) {
    return (
      <Text selectable style={styles.secondary}>
        [Image: {alt}]
      </Text>
    );
  }
  if (privateImage.failed || (privateImage.uri !== null && failedUri === privateImage.uri)) {
    return (
      <InlineMediaFrame height={imageHeight}>
        <View style={imageStyle}>
          <Text numberOfLines={3} selectable style={styles.secondary}>
            [Image: {alt}]
          </Text>
        </View>
      </InlineMediaFrame>
    );
  }
  if (privateImage.uri === null) {
    return (
      <InlineMediaFrame height={imageHeight}>
        <View style={imageStyle} />
      </InlineMediaFrame>
    );
  }
  const resolvedImageUri = privateImage.uri;
  return (
    <InlineMediaFrame height={imageHeight}>
      <NativeRevealSurface
        animate={reveal}
        ready={!reveal || loadedUri === resolvedImageUri || wasImageDecoded(resolvedImageUri)}
        revealKey={`image:${resolvedImageUri}`}
      >
        <Pressable
          accessibilityLabel={`Open ${alt}`}
          accessibilityRole="imagebutton"
          onPress={() => {
            openImagePreview({ ...previewItem, groupId });
          }}
          {...(safeTarget === null ? {} : { onLongPress: () => void Linking.openURL(safeTarget) })}
        >
          <Image
            accessibilityLabel={alt}
            onError={() => {
              setFailedUri(resolvedImageUri);
            }}
            onLoad={() => {
              recordDecodedImage(resolvedImageUri);
              setLoadedUri(resolvedImageUri);
            }}
            resizeMethod="resize"
            resizeMode="contain"
            source={privateImage.source ?? { uri: resolvedImageUri }}
            style={imageStyle}
          />
        </Pressable>
      </NativeRevealSurface>
    </InlineMediaFrame>
  );
}

function MarkdownTable({ path, table }: { path: string; table: Table }) {
  const animateStreaming = useContext(RichMarkdownRevealContext);
  const viewport = useTableViewport();
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  const minimumWidth = viewport.contentWidth;
  const { cellWidth, tableWidth } = markdownTableLayout(minimumWidth, columnCount);
  return (
    <View onLayout={viewport.onLayout} style={[styles.tableViewport, { width: viewport.width }]}>
      <HorizontalScrollView
        contentContainerStyle={[
          styles.tableHorizontalContent,
          minimumWidth > 0 ? { minWidth: minimumWidth } : null,
        ]}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.tableHorizontalScroller}
      >
        <View style={[styles.table, { width: tableWidth }]}>
          {/* Table rows/cells can lack source offsets; their append-only grid coordinates
              preserve identity across streaming and resize, including duplicate text. */}
          {table.children.map((row, rowIndex) => {
            const content = (
              <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHeader]}>
                {row.children.map((cell, cellIndex) => (
                  <TableCellView
                    align={table.align?.[cellIndex] ?? null}
                    cell={cell}
                    header={rowIndex === 0}
                    key={cellIndex}
                    width={cellWidth}
                  />
                ))}
              </View>
            );
            return animateStreaming ? (
              <NativeRevealSurface key={rowIndex} revealKey={`${path}:row:${String(rowIndex)}`}>
                {content}
              </NativeRevealSurface>
            ) : (
              content
            );
          })}
        </View>
      </HorizontalScrollView>
    </View>
  );
}

function TableCellView({
  align,
  cell,
  header,
  width,
}: {
  align: "left" | "right" | "center" | null;
  cell: TableCell;
  header: boolean;
  width: number;
}) {
  return (
    <Text
      style={[
        styles.tableCell,
        header && styles.tableCellHeader,
        { textAlign: align ?? "left", width },
      ]}
    >
      {inline(cell.children)}
    </Text>
  );
}

function inline(nodes: PhrasingContent[], insideLink = false): ReactNode[] {
  return nodes.map((node) => {
    const key = markdownNodeKey(node);
    switch (node.type) {
      case "text":
        return <HighlightSearchText key={key} text={node.value} />;
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {inline(node.children, insideLink)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} style={styles.emphasis}>
            {inline(node.children, insideLink)}
          </Text>
        );
      case "delete":
        return (
          <Text key={key} style={styles.deleted}>
            {inline(node.children, insideLink)}
          </Text>
        );
      case "inlineCode":
        return insideLink ? (
          <Text key={key} style={styles.inlineCode}>
            <HighlightSearchText text={node.value} />
          </Text>
        ) : (
          <CopyableInline key={key} style={styles.inlineCode} value={node.value}>
            <HighlightSearchText text={node.value} />
          </CopyableInline>
        );
      case "break":
        return "\n";
      case "link": {
        return (
          <MarkdownLink key={key} url={node.url}>
            {inline(node.children, true)}
          </MarkdownLink>
        );
      }
      case "image":
        return (
          <Text key={key} style={styles.secondary}>
            [Image: {node.alt ?? node.url}]
          </Text>
        );
      case "footnoteReference":
        return (
          <Text key={key} style={styles.secondary}>
            [{node.identifier}]
          </Text>
        );
      case "linkReference":
        return <Text key={key}>{inline(node.children)}</Text>;
      case "imageReference":
        return (
          <Text key={key} style={styles.secondary}>
            [Image: {node.alt ?? node.identifier}]
          </Text>
        );
      case "html":
        return (
          <Text key={key} style={styles.rawHtml}>
            {node.value}
          </Text>
        );
      default:
        return <Text key={key}>{fallbackText(node)}</Text>;
    }
  });
}

function markdownNodeKey(node: Nodes): string {
  return markdownNodeIdentity(node, fallbackText(node));
}

function headingStyle(depth: 1 | 2 | 3 | 4 | 5 | 6) {
  if (depth === 1) {
    return styles.headingOne;
  }
  if (depth === 2) {
    return styles.headingTwo;
  }
  if (depth === 3) {
    return styles.headingThree;
  }
  return styles.headingMinor;
}

const ALERT_CONFIG = {
  CAUTION: { color: colors.red, icon: "alert-circle-outline", label: "Caution" },
  IMPORTANT: { color: "#b59cff", icon: "sparkles-outline", label: "Important" },
  NOTE: { color: "#70a7ff", icon: "information-circle-outline", label: "Note" },
  TIP: { color: colors.green, icon: "bulb-outline", label: "Tip" },
  WARNING: { color: colors.amber, icon: "warning-outline", label: "Warning" },
} as const;

// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
function githubAlert(node: Extract<RootContent, { type: "blockquote" }>) {
  const first = node.children[0];
  if (first?.type !== "paragraph") {
    return null;
  }
  const firstInline = first.children[0];
  if (firstInline?.type !== "text") {
    return null;
  }
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+|$)/iu.exec(firstInline.value);
  if (match === null) {
    return null;
  }
  const kind = alertKind(match[1]);
  if (kind === null) {
    return null;
  }
  const remainingText = firstInline.value.slice(match[0].length);
  const firstChildren =
    remainingText === ""
      ? first.children.slice(1)
      : [{ ...firstInline, value: remainingText }, ...first.children.slice(1)];
  const children =
    firstChildren.length === 0
      ? node.children.slice(1)
      : [{ ...first, children: firstChildren }, ...node.children.slice(1)];
  return { ...ALERT_CONFIG[kind], children };
}

function alertKind(value: string | undefined): keyof typeof ALERT_CONFIG | null {
  const normalized = value?.toUpperCase();
  switch (normalized) {
    case undefined:
      return null;
    case "CAUTION":
    case "IMPORTANT":
    case "NOTE":
    case "TIP":
    case "WARNING":
      return normalized;
    default:
      return null;
  }
}

function fallbackText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  return `[${node.type}]`;
}

const styles = StyleSheet.create({
  alert: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    gap: spacing.xxs,
    minWidth: 0,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    width: "100%",
  },
  alertBody: {
    gap: spacing.xxs,
    minWidth: 0,
  },
  alertHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  alertTitle: {
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  blockquote: {
    borderLeftColor: colors.accent,
    borderLeftWidth: 2,
    gap: spacing.xxs,
    paddingLeft: spacing.xs,
  },
  codeContainer: {
    alignSelf: "stretch",
    backgroundColor: colors.code,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    padding: spacing.xs,
    width: "100%",
  },
  copyHintDone: { color: colors.green },
  copyPressed: { opacity: 0.76 },
  deleted: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  document: {
    gap: spacing.xxs,
    minWidth: 0,
  },
  emphasis: { fontStyle: "italic" },
  footnote: {
    alignItems: "flex-start",
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.compact,
    minWidth: 0,
    paddingTop: spacing.xxs,
    width: "100%",
  },
  footnoteBody: {
    flex: 1,
    gap: spacing.xxs,
    minWidth: 0,
  },
  footnoteMarker: {
    color: colors.accent,
    ...typeScale.caption,
  },
  heading: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    marginTop: spacing.xxs,
  },
  headingMinor: {
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  headingOne: { ...typeScale.heading },
  headingThree: {
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  headingTwo: { ...typeScale.title },
  inlineCode: {
    backgroundColor: colors.code,
    color: colors.text,
    fontFamily: "monospace",
  },
  link: {
    color: colors.accent,
    textDecorationLine: "underline",
  },
  list: {
    alignSelf: "flex-start",
    gap: spacing.xxs,
    minWidth: 0,
  },
  listBody: {
    flexShrink: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  listMarker: {
    color: colors.textMuted,
    textAlign: "right",
    width: typeScale.body.lineHeight,
    ...typeScale.body,
  },
  listRow: {
    alignItems: "flex-start",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.compact,
    minWidth: 0,
  },
  localImageLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    paddingVertical: spacing.xxs,
  },
  markdownImage: {
    backgroundColor: colors.code,
    borderRadius: radii.medium,
    height: 220,
    width: "100%",
  },
  paragraph: {
    color: colors.text,
    minWidth: 0,
    ...typeScale.body,
  },
  rawHtml: {
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  rule: { height: 8 },
  secondary: { color: colors.textMuted },
  strong: { fontWeight: typeWeight.semibold },
  table: {
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    overflow: "hidden",
  },
  tableCell: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: 1,
    color: colors.text,
    flexShrink: 0,
    minWidth: 144,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    ...typeScale.label,
  },
  tableCellHeader: { fontWeight: typeWeight.semibold },
  tableHeader: { backgroundColor: colors.surfaceHover },
  tableHorizontalContent: { flexGrow: 0 },
  tableHorizontalScroller: {
    flexGrow: 0,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  tableRow: {
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: 1,
    flexDirection: "row",
  },
  tableViewport: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  taskMarker: {
    alignItems: "flex-end",
    justifyContent: "center",
    minHeight: typeScale.body.lineHeight,
    width: typeScale.body.lineHeight,
  },
  truncated: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    paddingTop: spacing.xxs,
  },
  wideBlock: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
});
