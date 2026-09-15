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
import { Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";

import { colors, radii, typeScale, spacing, typeWeight, iconSize } from "../theme";
import { usePerformanceExperiment } from "../data/performance-experiments";
import { AppText } from "../ui/Typography";
import { isRemoteFileHref, remoteFileKind } from "./document-preview";
import { parseDiagnosticRichMarkdown } from "./diagnostic-markdown";
import { safeImageUri } from "./image-source";
import {
  useImagePreview,
  useImagePreviewGroup,
  useRegisterImagePreviewItem,
} from "./ImagePreviewHost";
import { useMarkdownLocalLinkHandler } from "./MarkdownLinkHandler";
import { markdownTableLayout } from "./markdown-table-layout";
import { collectMarkdownImageOrder } from "./markdown-image-order";
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
  target: ContentReviewTarget;
  pathPrefix: string;
} | null>(null);
const RichMarkdownRevealContext = createContext(false);

export function RichMarkdownTextScaleProvider({
  scale,
  children,
}: {
  scale: number;
  children: ReactNode;
}) {
  return (
    <RichMarkdownTextScaleContext.Provider value={Math.max(0.8, Math.min(1.4, scale))}>
      {children}
    </RichMarkdownTextScaleContext.Provider>
  );
}

/** Applies viewer-local typography without mutating global chat Markdown. */
function Text({
  style,
  reviewBlockPath,
  reviewOffset = 0,
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
  const fontSize = typeof flattened?.fontSize === "number" ? flattened.fontSize * scale : undefined;
  const lineHeight =
    typeof flattened?.lineHeight === "number" ? flattened.lineHeight * scale : undefined;
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
  if (review !== null && reviewBlockPath !== undefined) {
    return (
      <ReviewableText
        {...props}
        style={resolvedStyle}
        reviewHighlights={reviewHighlights}
        onReviewSelection={(selection) => {
          void beginReview({
            kind: "text",
            target: review.target,
            blockPath: blockPath as string,
            quote: selection.text,
            start: reviewOffset + selection.start,
            end: reviewOffset + selection.end,
          });
        }}
      />
    );
  }
  return <AppText {...props} style={resolvedStyle} />;
}

function InsetRichContentWidth({ inset, children }: { inset: number; children: ReactNode }) {
  const availableWidth = useRichContentWidth();
  const nestedWidth = availableWidth === null ? null : Math.max(1, availableWidth - inset);
  return <RichContentWidthProvider width={nestedWidth}>{children}</RichContentWidthProvider>;
}

export type RichExtensionRenderer = (value: string, meta: string | null) => ReactNode;

export function RichMarkdown({
  source,
  extensions = {},
  maxLines,
  targetLine,
  onTargetLayout,
  reviewTarget,
  reviewPathPrefix = "segment-0",
  streaming = false,
  animateStreaming = streaming,
}: {
  source: string;
  extensions?: Record<string, RichExtensionRenderer>;
  maxLines?: number;
  targetLine?: number;
  onTargetLayout?(y: number): void;
  reviewTarget?: ContentReviewTarget;
  reviewPathPrefix?: string;
  streaming?: boolean;
  animateStreaming?: boolean;
}) {
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  if (plainText) {
    return (
      <RichMarkdownReviewContext.Provider
        value={
          reviewTarget === undefined ? null : { target: reviewTarget, pathPrefix: reviewPathPrefix }
        }
      >
        <Text
          selectable
          reviewBlockPath="plain"
          {...(maxLines === undefined
            ? {}
            : { numberOfLines: maxLines, ellipsizeMode: "tail" as const })}
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
          reviewTarget === undefined ? null : { target: reviewTarget, pathPrefix: reviewPathPrefix }
        }
      >
        <Text
          selectable
          reviewBlockPath="truncated"
          numberOfLines={maxLines}
          ellipsizeMode="tail"
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
          reviewTarget === undefined ? null : { target: reviewTarget, pathPrefix: reviewPathPrefix }
        }
      >
        <View style={styles.document}>
          {parsed.root.children.map((node, index) => {
            const path = `${node.type}-${index}`;
            const block = (
              <BlockNode node={node} path={path} extensions={extensions} imageOrder={imageOrder} />
            );
            return index === targetBlockIndex && onTargetLayout !== undefined ? (
              <View
                key={path}
                collapsable={false}
                onLayout={({ nativeEvent }) => onTargetLayout(nativeEvent.layout.y)}
              >
                {block}
              </View>
            ) : (
              <BlockNode
                key={path}
                node={node}
                path={path}
                extensions={extensions}
                imageOrder={imageOrder}
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
  block,
  reviewTarget,
}: {
  block: MarkdownDocumentBlock;
  reviewTarget?: ContentReviewTarget;
}) {
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  return (
    <RichMarkdownRevealContext.Provider value={false}>
      <RichMarkdownReviewContext.Provider
        value={
          reviewTarget === undefined
            ? null
            : { target: reviewTarget, pathPrefix: block.reviewPathPrefix }
        }
      >
        {plainText ? (
          <Text selectable reviewBlockPath={block.path} style={styles.paragraph}>
            {plainRichMarkdownRootText(block.node)}
          </Text>
        ) : (
          <BlockNode
            node={block.node}
            path={block.path}
            extensions={{}}
            imageOrder={block.imageOrder}
          />
        )}
      </RichMarkdownReviewContext.Provider>
    </RichMarkdownRevealContext.Provider>
  );
}

function BlockNode({
  node,
  path,
  extensions,
  imageOrder,
}: {
  node: RootContent;
  path: string;
  extensions: Record<string, RichExtensionRenderer>;
  imageOrder: WeakMap<object, number>;
}) {
  const review = useContext(RichMarkdownReviewContext);
  const animateStreaming = useContext(RichMarkdownRevealContext);
  switch (node.type) {
    case "paragraph":
      if (node.children.length === 1 && node.children[0]?.type === "image") {
        const order = imageOrder.get(node.children[0]);
        return (
          <MarkdownImage
            url={node.children[0].url}
            alt={node.children[0].alt ?? "Image"}
            reveal={animateStreaming}
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
            url={image.url}
            alt={image.alt ?? "Image"}
            target={node.children[0].url}
            reveal={animateStreaming}
            {...(order === undefined ? {} : { order })}
          />
        );
      }
      return (
        <Text selectable reviewBlockPath={path} style={styles.paragraph}>
          {inline(node.children)}
        </Text>
      );
    case "heading": {
      const style = [styles.heading, headingStyle(node.depth)];
      return (
        <Text selectable reviewBlockPath={path} style={style}>
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
              <Ionicons name={alert.icon} size={iconSize.inline} color={alert.color} />
              <Text style={[styles.alertTitle, { color: alert.color }]}>{alert.label}</Text>
            </View>
            <View style={styles.alertBody}>
              <InsetRichContentWidth inset={18}>
                {alert.children.map((child, index) => (
                  <BlockNode
                    key={index}
                    node={child}
                    path={`${path}/alert-${index}`}
                    extensions={extensions}
                    imageOrder={imageOrder}
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
                key={index}
                node={child}
                path={`${path}/quote-${index}`}
                extensions={extensions}
                imageOrder={imageOrder}
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
            <View key={index} style={styles.listRow}>
              {typeof item.checked === "boolean" ? (
                <View
                  accessibilityLabel={item.checked ? "Completed task" : "Open task"}
                  style={styles.taskMarker}
                >
                  <Ionicons
                    name={item.checked ? "checkbox" : "square-outline"}
                    size={iconSize.inline}
                    color={item.checked ? colors.green : colors.textMuted}
                  />
                </View>
              ) : (
                <Text style={styles.listMarker}>
                  {node.ordered ? `${(node.start ?? 1) + index}.` : "•"}
                </Text>
              )}
              <View style={styles.listBody}>
                <InsetRichContentWidth inset={25}>
                  {item.children.map((child, childIndex) => (
                    <BlockNode
                      key={childIndex}
                      node={child}
                      path={`${path}/item-${index}-${childIndex}`}
                      extensions={extensions}
                      imageOrder={imageOrder}
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
      if (language.toLocaleLowerCase() === "mermaid")
        return (
          <View style={styles.wideBlock}>
            <MermaidDiagram
              source={node.value}
              reveal={animateStreaming}
              {...(review === null
                ? {}
                : { reviewTarget: review.target, diagramId: `${review.pathPrefix}/${path}` })}
            />
          </View>
        );
      if (looksLikeAsciiDiagram(node.value, node.lang))
        return (
          <View style={styles.wideBlock}>
            <AsciiDiagram source={node.value} />
          </View>
        );
      if (language.startsWith("codex-")) {
        const extension = extensions[language.slice("codex-".length)];
        if (extension !== undefined) return <>{extension(node.value, node.meta ?? null)}</>;
      }
      return <CopyableCodeBlock value={node.value} language={language} />;
    }
    case "table":
      return <MarkdownTable table={node} path={path} />;
    case "thematicBreak":
      return <View style={styles.rule} />;
    case "html":
      return (
        <MarkupBlock node={node} path={path} extensions={extensions} imageOrder={imageOrder} />
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
                key={index}
                node={child}
                path={`${path}/footnote-${index}`}
                extensions={extensions}
                imageOrder={imageOrder}
              />
            ))}
          </View>
        </View>
      );
    case "definition":
    case "yaml":
      return null;
    default:
      return (
        <Text selectable reviewBlockPath={path} style={styles.secondary}>
          {fallbackText(node)}
        </Text>
      );
  }
}

function MarkupBlock({
  node,
  path,
  extensions,
  imageOrder,
}: {
  node: Extract<RootContent, { type: "html" }>;
  path: string;
  extensions: Record<string, RichExtensionRenderer>;
  imageOrder: WeakMap<object, number>;
}) {
  const animateStreaming = useContext(RichMarkdownRevealContext);
  const html = messageMarkupNodeHtml(node);
  if (html === null)
    return (
      <CopyableInline value={node.value} style={styles.rawHtml}>
        {node.value}
      </CopyableInline>
    );
  return (
    <NativeMarkup
      html={html}
      code={(value, language, childPath) => (
        <BlockNode
          node={{ type: "code", value, lang: language }}
          path={`${path}/${childPath}`}
          extensions={extensions}
          imageOrder={imageOrder}
        />
      )}
      image={(url, alt, dimensions) => (
        <MarkdownImage
          url={url}
          alt={alt}
          reveal={animateStreaming}
          {...(dimensions === undefined ? {} : { dimensions })}
        />
      )}
      link={(url, children) => <MarkdownLink url={url}>{children}</MarkdownLink>}
    />
  );
}

function CopyableCodeBlock({ value, language }: { value: string; language: string }) {
  const [copied, copy] = useCopyFeedback(value);
  const scale = useContext(RichMarkdownTextScaleContext);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Copy ${language} code block`}
      onPress={copy}
      style={({ pressed }) => [styles.codeContainer, pressed && styles.copyPressed]}
    >
      <CodeBlockHeader language={language} copied={copied} scale={scale} />
      <NativeCodeBlock value={value} language={language} />
    </Pressable>
  );
}

function CopyableInline({
  value,
  children,
  style,
  onLongPress,
}: {
  value: string;
  children: ReactNode;
  style?: object;
  onLongPress?(): void;
}) {
  const [copied, copy] = useCopyFeedback(value);
  return (
    <Text
      accessibilityRole="button"
      accessibilityHint={
        onLongPress === undefined
          ? "Copies to clipboard"
          : "Copies to clipboard; long press opens the link"
      }
      onPress={copy}
      {...(onLongPress === undefined ? {} : { onLongPress })}
      style={[style, copied && styles.copyHintDone]}
    >
      {children}
    </Text>
  );
}

function MarkdownLink({ url, children }: { url: string; children: ReactNode }) {
  const openLocalLink = useMarkdownLocalLinkHandler();
  const external = isSafeLink(url);
  const localKind =
    !external && openLocalLink !== null && isRemoteFileHref(url) ? remoteFileKind(url, url) : null;
  const local = localKind !== null;
  if (!external && !local) return <Text style={styles.secondary}>{children}</Text>;
  return (
    <Text
      accessibilityRole="link"
      accessibilityHint="Opens the link"
      onPress={() => {
        if (openLocalLink?.(url)) return;
        if (external) void Linking.openURL(url);
      }}
      style={styles.link}
    >
      {children}
      {(external || localKind === "download") && " "}
      {external && <Ionicons name="open-outline" size={iconSize.indicator} color={colors.accent} />}
      {localKind === "download" && (
        <Ionicons name="download-outline" size={iconSize.indicator} color={colors.accent} />
      )}
    </Text>
  );
}

function useCopyFeedback(value: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = () => {
    void Clipboard.setStringAsync(value);
    setCopied(true);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, 900);
  };
  return [copied, copy];
}

function MarkdownImage({
  url,
  alt,
  target = url,
  order,
  reveal = false,
  dimensions,
}: {
  url: string;
  alt: string;
  target?: string;
  order?: number;
  reveal?: boolean;
  dimensions?: MarkupImageDimensions;
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
    id: groupId === null ? previewId : `${groupId}:${url}:${alt}`,
    label: alt,
    source: privateImage.source ?? { uri: imageUri ?? "" },
    link: safeTarget,
    reference: url,
    ...(order === undefined ? {} : { order }),
  };
  useRegisterImagePreviewItem(inGallery ? null : groupId, previewItem);
  if (inGallery) return null;
  if (
    imageUri === null &&
    openLocalLink !== null &&
    isRemoteFileHref(url) &&
    remoteFileKind(alt, url) === "image"
  ) {
    return (
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Open ${alt}`}
        onPress={() => openLocalLink(url)}
        style={styles.localImageLink}
      >
        <Ionicons name="image-outline" size={iconSize.inline} color={colors.accent} />
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.link}>
          {alt}
        </Text>
      </Pressable>
    );
  }
  if (imageUri === null)
    return (
      <Text selectable style={styles.secondary}>
        [Image: {alt}]
      </Text>
    );
  if (privateImage.failed || (privateImage.uri !== null && failedUri === privateImage.uri))
    return (
      <InlineMediaFrame height={imageHeight}>
        <View style={imageStyle}>
          <Text selectable numberOfLines={3} style={styles.secondary}>
            [Image: {alt}]
          </Text>
        </View>
      </InlineMediaFrame>
    );
  if (privateImage.uri === null)
    return (
      <InlineMediaFrame height={imageHeight}>
        <View style={imageStyle} />
      </InlineMediaFrame>
    );
  return (
    <InlineMediaFrame height={imageHeight}>
      <NativeRevealSurface
        animate={reveal}
        ready={!reveal || loadedUri === privateImage.uri}
        revealKey={`image:${privateImage.uri}`}
      >
        <Pressable
          accessibilityRole="imagebutton"
          accessibilityLabel={`Open ${alt}`}
          onPress={() => openImagePreview({ ...previewItem, groupId })}
          {...(safeTarget === null ? {} : { onLongPress: () => void Linking.openURL(safeTarget) })}
        >
          <Image
            accessibilityLabel={alt}
            source={privateImage.source ?? { uri: privateImage.uri }}
            resizeMode="contain"
            resizeMethod="resize"
            style={imageStyle}
            onLoad={() => setLoadedUri(privateImage.uri)}
            onError={() => setFailedUri(privateImage.uri)}
          />
        </Pressable>
      </NativeRevealSurface>
    </InlineMediaFrame>
  );
}

function MarkdownTable({ table, path }: { table: Table; path: string }) {
  const animateStreaming = useContext(RichMarkdownRevealContext);
  const availableWidth = useRichContentWidth();
  const [viewportWidth, setViewportWidth] = useState(0);
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  // The surrounding bubble is intrinsic-width. Measuring only this child
  // creates a circular layout in which a narrow table can never pull the
  // bubble out to its available width. The pane owns the concrete rich-content
  // width, so use it as the minimum and keep onLayout only as a fallback for
  // standalone renderers without a provider.
  const minimumWidth =
    availableWidth !== null && availableWidth > 0 ? availableWidth : viewportWidth;
  const { tableWidth, cellWidth } = markdownTableLayout(minimumWidth, columnCount);
  return (
    <View
      style={[styles.tableViewport, minimumWidth > 0 ? { width: minimumWidth } : null]}
      onLayout={({ nativeEvent }) => setViewportWidth(Math.ceil(nativeEvent.layout.width))}
    >
      <HorizontalScrollView
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        style={styles.tableHorizontalScroller}
        contentContainerStyle={[
          styles.tableHorizontalContent,
          minimumWidth > 0 ? { minWidth: minimumWidth } : null,
        ]}
      >
        <View style={[styles.table, { width: tableWidth }]}>
          {table.children.map((row, rowIndex) => {
            const content = (
              <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHeader]}>
                {row.children.map((cell, cellIndex) => (
                  <TableCellView
                    key={cellIndex}
                    cell={cell}
                    width={cellWidth}
                    header={rowIndex === 0}
                    align={table.align?.[cellIndex] ?? null}
                  />
                ))}
              </View>
            );
            return animateStreaming ? (
              <NativeRevealSurface key={rowIndex} revealKey={`${path}:row:${rowIndex}`}>
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
  cell,
  width,
  header,
  align,
}: {
  cell: TableCell;
  width: number;
  header: boolean;
  align: "left" | "right" | "center" | null;
}) {
  return (
    <Text
      style={[
        styles.tableCell,
        header && styles.tableCellHeader,
        { width, textAlign: align ?? "left" },
      ]}
    >
      {inline(cell.children)}
    </Text>
  );
}

function inline(nodes: PhrasingContent[], insideLink = false): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <HighlightSearchText key={index} text={node.value} />;
      case "strong":
        return (
          <Text key={index} style={styles.strong}>
            {inline(node.children, insideLink)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={index} style={styles.emphasis}>
            {inline(node.children, insideLink)}
          </Text>
        );
      case "delete":
        return (
          <Text key={index} style={styles.deleted}>
            {inline(node.children, insideLink)}
          </Text>
        );
      case "inlineCode":
        return insideLink ? (
          <Text key={index} style={styles.inlineCode}>
            <HighlightSearchText text={node.value} />
          </Text>
        ) : (
          <CopyableInline key={index} value={node.value} style={styles.inlineCode}>
            <HighlightSearchText text={node.value} />
          </CopyableInline>
        );
      case "break":
        return "\n";
      case "link": {
        return (
          <MarkdownLink key={index} url={node.url}>
            {inline(node.children, true)}
          </MarkdownLink>
        );
      }
      case "image":
        return (
          <Text key={index} style={styles.secondary}>
            [Image: {node.alt ?? node.url}]
          </Text>
        );
      case "footnoteReference":
        return (
          <Text key={index} style={styles.secondary}>
            [{node.identifier}]
          </Text>
        );
      case "linkReference":
        return <Text key={index}>{inline(node.children)}</Text>;
      case "imageReference":
        return (
          <Text key={index} style={styles.secondary}>
            [Image: {node.alt ?? node.identifier}]
          </Text>
        );
      case "html":
        return (
          <Text key={index} style={styles.rawHtml}>
            {node.value}
          </Text>
        );
      default:
        return <Text key={index}>{fallbackText(node)}</Text>;
    }
  });
}

function headingStyle(depth: 1 | 2 | 3 | 4 | 5 | 6) {
  if (depth === 1) return styles.headingOne;
  if (depth === 2) return styles.headingTwo;
  if (depth === 3) return styles.headingThree;
  return styles.headingMinor;
}

const ALERT_CONFIG = {
  NOTE: { label: "Note", icon: "information-circle-outline", color: "#70a7ff" },
  TIP: { label: "Tip", icon: "bulb-outline", color: colors.green },
  IMPORTANT: { label: "Important", icon: "sparkles-outline", color: "#b59cff" },
  WARNING: { label: "Warning", icon: "warning-outline", color: colors.amber },
  CAUTION: { label: "Caution", icon: "alert-circle-outline", color: colors.red },
} as const;

function githubAlert(node: Extract<RootContent, { type: "blockquote" }>) {
  const first = node.children[0];
  if (first?.type !== "paragraph") return null;
  const firstInline = first.children[0];
  if (firstInline?.type !== "text") return null;
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+|$)/iu.exec(firstInline.value);
  if (match === null) return null;
  const kind = match[1]!.toUpperCase() as keyof typeof ALERT_CONFIG;
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

function fallbackText(node: Nodes): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return `[${node.type}]`;
}

const styles = StyleSheet.create({
  document: {
    minWidth: 0,
    gap: spacing.xxs,
  },
  wideBlock: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  paragraph: {
    minWidth: 0,
    color: colors.text,
    ...typeScale.body,
  },
  heading: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    marginTop: spacing.xxs,
  },
  headingOne: { ...typeScale.heading },
  headingTwo: { ...typeScale.title },
  headingThree: {
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  headingMinor: {
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  strong: { fontWeight: typeWeight.semibold },
  emphasis: { fontStyle: "italic" },
  deleted: {
    textDecorationLine: "line-through",
    color: colors.textMuted,
  },
  inlineCode: {
    color: colors.text,
    backgroundColor: colors.code,
    fontFamily: "monospace",
  },
  link: {
    color: colors.accent,
    textDecorationLine: "underline",
  },
  secondary: { color: colors.textMuted },
  blockquote: {
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.xs,
    gap: spacing.xxs,
  },
  alert: {
    width: "100%",
    minWidth: 0,
    borderRadius: radii.small,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    gap: spacing.xxs,
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  alertTitle: {
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  alertBody: {
    minWidth: 0,
    gap: spacing.xxs,
  },
  list: {
    minWidth: 0,
    alignSelf: "flex-start",
    gap: spacing.xxs,
  },
  listRow: {
    minWidth: 0,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.compact,
  },
  listMarker: {
    color: colors.textMuted,
    width: typeScale.body.lineHeight,
    textAlign: "right",
    ...typeScale.body,
  },
  taskMarker: {
    width: typeScale.body.lineHeight,
    minHeight: typeScale.body.lineHeight,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  listBody: {
    minWidth: 0,
    flexShrink: 1,
    gap: spacing.optical,
  },
  footnote: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.compact,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.xxs,
  },
  footnoteMarker: {
    color: colors.accent,
    ...typeScale.caption,
  },
  footnoteBody: {
    minWidth: 0,
    flex: 1,
    gap: spacing.xxs,
  },
  codeContainer: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    backgroundColor: colors.code,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xs,
    gap: spacing.xxs,
  },
  copyHintDone: { color: colors.green },
  copyPressed: { opacity: 0.76 },
  rawHtml: {
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  rule: { height: 8 },
  tableViewport: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  tableHorizontalScroller: {
    flexGrow: 0,
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
  },
  tableHorizontalContent: { flexGrow: 0 },
  table: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.small,
    overflow: "hidden",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  tableHeader: { backgroundColor: colors.surfaceHover },
  tableCell: {
    flexShrink: 0,
    color: colors.text,
    minWidth: 144,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft,
    ...typeScale.label,
  },
  tableCellHeader: { fontWeight: typeWeight.semibold },
  truncated: {
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
    paddingTop: spacing.xxs,
  },
  markdownImage: {
    width: "100%",
    height: 220,
    borderRadius: radii.medium,
    backgroundColor: colors.code,
  },
  localImageLink: {
    minWidth: 0,
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
  },
});
