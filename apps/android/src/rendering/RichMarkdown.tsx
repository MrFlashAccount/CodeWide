import type { ListItem, Nodes, PhrasingContent, RootContent, Table, TableCell } from "mdast";
import { messageMarkupNodeHtml } from "@codewide/rendering-core/markup";
import { ArtifactImageReferences } from "./ArtifactImageReferences";
import {
  isSafeLink,
  plainRichMarkdownRootText,
  richMarkdownBlockIndexAtLine,
} from "@codewide/rendering-core";
import { Ionicons } from "@expo/vector-icons";
import {
  createContext,
  type ComponentProps,
  type ReactNode,
  useContext,
  useId,
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
  type ViewStyle,
} from "react-native";
import { occurrenceKey } from "./listKey";
import { ScrollView as GestureScrollView } from "react-native-gesture-handler";

import { colors, radii, typeScale, spacing, typeWeight, iconSize } from "../theme";
import { usePerformanceExperiment } from "../data/performance-experiments";
import { useEvent } from "../react/useEvent";
import { AppText } from "../ui/Typography";
import { useAppDialog } from "../ui/AppDialog";
import { isRemoteFileHref, remoteFileKind } from "./document-preview";
import { parseDiagnosticRichMarkdown } from "./diagnostic-markdown";
import type { ParsedMarkdownSegment } from "./rich-markdown-layout";
import { safeImageUri } from "./image-source";
import { recordDecodedImage, wasImageDecoded } from "./imageDecodeCache";
import {
  useImagePreview,
  useImagePreviewGroup,
  useRegisterImagePreviewItem,
} from "./ImagePreviewHost";
import { MarkdownWebLinkContext } from "./markdownWebLink";
import { useMarkdownLocalLinkHandler } from "./MarkdownLinkHandler";
import { markdownTableLayout } from "./markdown-table-layout";
import { useTableViewport } from "./useTableViewport";
import { markdownNodeIdentity } from "./markdownNodeIdentity";
import { collectMarkdownImageOrder, type MarkdownImageNode } from "./markdown-image-order";
import type { ChatMarkdownBlock } from "./markdownListGroups";
import { NativeMarkdownTable } from "./NativeMarkdownTable";
import { NativeMarkdownList } from "./NativeMarkdownList";
import { AsciiDiagram, MermaidDiagram } from "./MermaidDiagram";
import { CodeBlock } from "./CodeBlock";
import { NativeRevealSurface } from "./NativeRevealSurface";
import { InlineMediaFrame, INLINE_MEDIA_PREVIEW_HEIGHT } from "./InlineMediaFrame";
import type { MarkupImageDimensions } from "./markup-image-dimensions";
import { useContentReview, useContentReviewHighlights } from "./ContentReviewHost";
import type { ContentReviewTarget } from "./content-review";
import type { ReviewSelection } from "./ReviewableText.native";
import { ReviewableText } from "./ReviewableText";
import { isExplicitAsciiDiagram } from "./ascii-diagram";
import { ChatTableWidthContext } from "./chatTableWidth";
import { RichContentWidthProvider, useRichContentWidth } from "./RichContentLayout";
import { useSelector } from "@legendapp/state/react";
import { usePrivateImageUri } from "./use-private-image-uri";
import { NativeMarkup } from "./NativeMarkup";
import { HighlightSearchText, SearchHighlightQuery } from "./SearchMessageFocus";
import {
  layoutRichMarkdownInline,
  projectMarkdownAlert,
  richMarkdownGeometry,
  type RichMarkdownInlineRun,
} from "./richMarkdownGeometry";
import {
  useRichMarkdownPremeasurement,
  useRichMarkdownTextBreakStrategy,
} from "./richMarkdownLayoutPolicy";
import { useCopyFeedback } from "./useCopyFeedback";

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
function Text({
  reviewBlockPath,
  reviewOffset = 0,
  style,
  textBreakStrategy,
  ...props
}: ComponentProps<typeof AppText> & {
  reviewBlockPath?: string;
  reviewOffset?: number;
}) {
  const scale = useContext(RichMarkdownTextScaleContext);
  const review = useContext(RichMarkdownReviewContext);
  const premeasuredTextBreakStrategy = useRichMarkdownTextBreakStrategy();
  const resolvedTextBreakStrategy = premeasuredTextBreakStrategy ?? textBreakStrategy;
  const resolvedStyle = scale === 1 ? style : scaledMarkdownStyle(style, scale);
  if (review === null || reviewBlockPath === undefined) {
    return (
      <AppText {...props} style={resolvedStyle} textBreakStrategy={resolvedTextBreakStrategy} />
    );
  }
  return (
    <ReviewBlockText
      {...props}
      blockPath={`${review.pathPrefix}/${reviewBlockPath}`}
      offset={reviewOffset}
      style={resolvedStyle}
      target={review.target}
      textBreakStrategy={resolvedTextBreakStrategy}
    />
  );
}

function scaledMarkdownStyle(style: StyleProp<TextStyle>, scale: number): StyleProp<TextStyle> {
  const flattened = StyleSheet.flatten(style);
  return [
    style,
    {
      ...(typeof flattened.fontSize === "number" ? { fontSize: flattened.fontSize * scale } : {}),
      ...(typeof flattened.lineHeight === "number"
        ? { lineHeight: flattened.lineHeight * scale }
        : {}),
    },
  ];
}

function ReviewBlockText({
  blockPath,
  offset,
  target,
  ...props
}: ComponentProps<typeof AppText> & {
  blockPath: string;
  offset: number;
  target: ContentReviewTarget;
}) {
  const beginReview = useContentReview();
  const highlights = useContentReviewHighlights(target.id, blockPath, offset);
  const reviewSelection = useEvent((selection: ReviewSelection) => {
    beginReview({
      blockPath,
      end: offset + selection.end,
      kind: "text",
      quote: selection.text,
      start: offset + selection.start,
      target,
    });
  });
  return (
    <ReviewableText {...props} onReviewSelection={reviewSelection} reviewHighlights={highlights} />
  );
}

function PremeasuredInlineText({
  containerStyle,
  node,
  path,
  style,
}: {
  containerStyle?: StyleProp<ViewStyle>;
  node: Extract<RootContent, { type: "heading" | "paragraph" }>;
  path: string;
  style: StyleProp<TextStyle>;
}) {
  const policy = useRichMarkdownPremeasurement();
  const highlight = useContext(SearchHighlightQuery) !== "";
  const width = useRichContentWidth();
  if (policy === null || width === null) {
    return (
      <Text reviewBlockPath={path} selectable style={style}>
        {inline(node.children, highlight)}
      </Text>
    );
  }
  const layout = layoutRichMarkdownInline(node, { fontScale: policy.fontScale, width });
  if (layout.status === "dynamic") {
    return (
      <Text reviewBlockPath={path} selectable style={style}>
        {inline(node.children, highlight)}
      </Text>
    );
  }
  return (
    <View accessibilityLabel={fallbackText(node)} accessible style={containerStyle}>
      {layout.lines.map((line, lineIndex) => (
        <Text
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          key={`${path}-line-${String(lineIndex)}`}
          numberOfLines={1}
          reviewBlockPath={path}
          reviewOffset={line.reviewOffset}
          selectable
          style={[style, styles.premeasuredLine]}
        >
          {line.fragments.length === 0
            ? "\u200B"
            : line.fragments.map((fragment, fragmentIndex) => (
                <PremeasuredInlineRun
                  key={`${String(fragmentIndex)}-${fragment.text}`}
                  run={fragment.run}
                  text={fragment.text}
                />
              ))}
        </Text>
      ))}
    </View>
  );
}

function PremeasuredInlineRun({ run, text }: { run: RichMarkdownInlineRun; text: string }) {
  const style = premeasuredInlineStyle(run);
  if (run.presentation.icon !== null) {
    return (
      <MarkdownLink appendIcon={false} url={run.presentation.interaction.url}>
        <Ionicons
          color={colors.accent}
          name={premeasuredIconName(run.presentation.icon)}
          size={iconSize.indicator}
        />
      </MarkdownLink>
    );
  }
  const content = <HighlightSearchText text={text} />;
  if (run.presentation.interaction?.kind === "link") {
    return (
      <MarkdownLink appendIcon={false} url={run.presentation.interaction.url}>
        <Text style={style}>{content}</Text>
      </MarkdownLink>
    );
  }
  if (run.presentation.interaction?.kind === "copy") {
    return (
      <CopyableInline style={[style, styles.inlineCode]} value={run.presentation.interaction.value}>
        {content}
      </CopyableInline>
    );
  }
  return <Text style={[style, premeasuredToneStyle(run.presentation.tone)]}>{content}</Text>;
}

function premeasuredInlineStyle(run: RichMarkdownInlineRun): TextStyle {
  return {
    fontFamily:
      typeof run.flow.style.fontFamily === "string" ? run.flow.style.fontFamily : undefined,
    fontSize: run.flow.style.fontSize,
    fontStyle: run.flow.style.fontStyle,
    fontWeight: "400",
    lineHeight: run.flow.style.lineHeight,
    textDecorationLine: run.presentation.decoration,
  };
}

function premeasuredIconName(icon: "download" | "external"): "download-outline" | "open-outline" {
  return icon === "external" ? "open-outline" : "download-outline";
}

function premeasuredToneStyle(
  tone: RichMarkdownInlineRun["presentation"]["tone"],
): TextStyle | undefined {
  if (tone === "secondary") {
    return styles.secondary;
  }
  return tone === "code" ? styles.inlineCode : undefined;
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
  segment,
  source: rawSource,
  targetLine,
}: (
  | {
      readonly segment?: never;
      readonly source: string;
      readonly streaming?: boolean;
    }
  | {
      readonly segment: ParsedMarkdownSegment;
      readonly source?: never;
      readonly streaming?: never;
    }
) & {
  animateStreaming?: boolean;
  extensions?: Record<string, RichExtensionRenderer>;
  maxLines?: number;
  onTargetLayout?: (y: number) => void;
  reviewPathPrefix?: string;
  reviewTarget?: ContentReviewTarget;
  targetLine?: number;
}) {
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  const premeasurement = useRichMarkdownPremeasurement();
  const source = segment === undefined ? rawSource : segment.source;
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
  const parsed = segment?.parsed ?? parseDiagnosticRichMarkdown(source, !streaming);
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
  const first = parsed.root.children[0];
  if (
    parsed.root.children.length === 1 &&
    first?.type === "paragraph" &&
    first.children.length === 1 &&
    first.children[0]?.type === "text" &&
    !parsed.truncated &&
    targetLine === undefined &&
    premeasurement === null
  ) {
    return (
      <MarkdownParagraphText
        nodes={first.children}
        path={`${reviewPathPrefix}/paragraph-0`}
        style={styles.paragraph}
        target={reviewTarget}
      />
    );
  }
  const imageOrder = collectMarkdownImageOrder(parsed.root);
  const blockOccurrences = new Map<string, number>();
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
            const key = markdownNodeKey(blockOccurrences, node);
            const block = (
              <BlockNode
                documentRoot
                extensions={extensions}
                imageOrder={imageOrder}
                node={node}
                path={path}
              />
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
                documentRoot
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

type DocumentBlockProps = {
  animateStreaming?: boolean;
  block: ChatMarkdownBlock;
  completedChat?: boolean;
  reviewTarget?: ContentReviewTarget;
};

/** Renders one document viewport item with the same review address as the full renderer. */
export function RichMarkdownDocumentBlockView(props: DocumentBlockProps) {
  const { block, reviewTarget } = props;
  const plainText = usePerformanceExperiment("plainTextMarkdown");
  const policy = useRichMarkdownPremeasurement();
  const node = block.node;
  if (!plainText && policy === null && isInlineTextBlock(node)) {
    return (
      <MarkdownParagraphText
        nodes={node.children}
        path={`${block.reviewPathPrefix}/${block.path}`}
        style={
          node.type === "heading" ? [styles.heading, headingStyle(node.depth)] : styles.paragraph
        }
        target={reviewTarget}
      />
    );
  }
  const content = documentBlockContent(props, plainText);
  if (block.listGroup === undefined) {
    return content;
  }
  return (
    <NativeMarkdownList group={block.listGroup} target={reviewTarget}>
      {content}
    </NativeMarkdownList>
  );
}

function documentBlockContent(
  { animateStreaming = false, block, completedChat = false, reviewTarget }: DocumentBlockProps,
  plainText: boolean,
) {
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
        ) : completedChat && block.node.type === "table" ? (
          <MarkdownTable completedChat documentRoot path={block.path} table={block.node} />
        ) : (
          <BlockNode
            documentRoot
            extensions={EMPTY_RICH_EXTENSIONS}
            firstListItem={block.listGroup?.firstItem}
            imageOrder={block.imageOrder}
            node={block.node}
            path={block.path}
          />
        )}
      </RichMarkdownReviewContext.Provider>
    </RichMarkdownRevealContext.Provider>
  );
}

// Standalone images (including linked images) use the media viewer and its gallery order.
function isInlineTextBlock(
  node: RootContent,
): node is Extract<RootContent, { type: "paragraph" | "heading" }> {
  if (node.type !== "paragraph") {
    return node.type === "heading";
  }
  if (node.children.length !== 1) {
    return true;
  }
  const only = node.children[0];
  if (only?.type === "link") {
    return !singleImage(only.children);
  }
  return only?.type !== "image";
}

function singleImage(nodes: PhrasingContent[]): boolean {
  return nodes.length === 1 && nodes[0]?.type === "image";
}

function MarkdownParagraphText({
  nodes,
  path,
  style,
  target,
}: {
  nodes: PhrasingContent[];
  path: string;
  style: StyleProp<TextStyle>;
  target: ContentReviewTarget | undefined;
}) {
  const scale = useContext(RichMarkdownTextScaleContext);
  const highlight = useContext(SearchHighlightQuery) !== "";
  const resolvedStyle = scale === 1 ? style : scaledMarkdownStyle(style, scale);
  const children = inline(nodes, highlight);
  return target === undefined ? (
    <AppText selectable style={resolvedStyle}>
      {children}
    </AppText>
  ) : (
    <ReviewBlockText blockPath={path} offset={0} selectable style={resolvedStyle} target={target}>
      {children}
    </ReviewBlockText>
  );
}

// WHY: This V1 render boundary owns one existing decision tree and its local state ordering; splitting it would risk changing visible behavior.
// oxlint-disable-next-line eslint/complexity
function BlockNode({
  documentRoot = false,
  extensions,
  firstListItem = 0,
  imageOrder,
  node,
  path,
}: {
  documentRoot?: boolean;
  extensions: Record<string, RichExtensionRenderer>;
  firstListItem?: number | undefined;
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
      return <PremeasuredInlineText node={node} path={path} style={styles.paragraph} />;
    case "heading": {
      const style = [styles.heading, headingStyle(node.depth)];
      return (
        <PremeasuredInlineText
          containerStyle={styles.premeasuredHeading}
          node={node}
          path={path}
          style={style}
        />
      );
    }
    case "blockquote": {
      const occurrences = new Map<string, number>();
      const alert = projectMarkdownAlert(node);
      if (alert !== null) {
        const presentation = ALERT_CONFIG[alert.kind];
        return (
          <View style={styles.alert}>
            <View style={styles.alertHeader}>
              <Ionicons
                color={presentation.color}
                name={presentation.icon}
                size={iconSize.inline}
              />
              <Text style={[styles.alertTitle, { color: presentation.color }]}>
                {presentation.label}
              </Text>
            </View>
            <View style={styles.alertBody}>
              <InsetRichContentWidth inset={richMarkdownGeometry.alertBodyInset}>
                {alert.children.map((child, index) => (
                  <BlockNode
                    extensions={extensions}
                    imageOrder={imageOrder}
                    key={markdownNodeKey(occurrences, child)}
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
          <InsetRichContentWidth inset={richMarkdownGeometry.blockquoteInset}>
            {node.children.map((child, index) => (
              <BlockNode
                extensions={extensions}
                imageOrder={imageOrder}
                key={markdownNodeKey(occurrences, child)}
                node={child}
                path={`${path}/quote-${String(index)}`}
              />
            ))}
          </InsetRichContentWidth>
        </View>
      );
    }
    case "list": {
      const occurrences = new Map<string, number>();
      return (
        <View style={styles.list}>
          {node.children.map((item, index) => (
            <View key={markdownNodeKey(occurrences, item)} style={styles.listRow}>
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
              <MarkdownListBody
                extensions={extensions}
                imageOrder={imageOrder}
                item={item}
                path={`${path}/item-${String(firstListItem + index)}`}
              />
            </View>
          ))}
        </View>
      );
    }
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
      if (isExplicitAsciiDiagram(node.lang)) {
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
      return <MarkdownTable documentRoot={documentRoot} path={path} table={node} />;
    case "thematicBreak":
      return <View style={styles.rule} />;
    case "html":
      return (
        <MarkupBlock extensions={extensions} imageOrder={imageOrder} node={node} path={path} />
      );
    case "footnoteDefinition": {
      const occurrences = new Map<string, number>();
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
                key={markdownNodeKey(occurrences, child)}
                node={child}
                path={`${path}/footnote-${String(index)}`}
              />
            ))}
          </View>
        </View>
      );
    }
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

/** A one-paragraph list item can be the flex child itself. Rich items still provide the inset width. */
function MarkdownListBody({
  extensions,
  imageOrder,
  item,
  path,
}: {
  extensions: Record<string, RichExtensionRenderer>;
  imageOrder: WeakMap<MarkdownImageNode, number>;
  item: ListItem;
  path: string;
}) {
  const review = useContext(RichMarkdownReviewContext);
  const policy = useRichMarkdownPremeasurement();
  const child = onlyListParagraph(item);
  if (policy === null && child !== null) {
    return (
      <MarkdownParagraphText
        nodes={child.children}
        path={`${review?.pathPrefix ?? ""}/${path}-0`}
        style={[styles.paragraph, styles.listBody]}
        target={review?.target}
      />
    );
  }
  const occurrences = new Map<string, number>();
  return (
    <View style={styles.listBody}>
      <InsetRichContentWidth inset={richMarkdownGeometry.listInset}>
        {item.children.map((block, index) => (
          <BlockNode
            extensions={extensions}
            imageOrder={imageOrder}
            key={markdownNodeKey(occurrences, block)}
            node={block}
            path={`${path}-${String(index)}`}
          />
        ))}
      </InsetRichContentWidth>
    </View>
  );
}

function onlyListParagraph(item: ListItem): Extract<RootContent, { type: "paragraph" }> | null {
  const child = item.children[0];
  return item.children.length === 1 && child?.type === "paragraph" && isInlineTextBlock(child)
    ? child
    : null;
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
  const renderCode = (value: string, language: string, childPath: string) => (
    <BlockNode
      extensions={extensions}
      imageOrder={imageOrder}
      node={{ lang: language, type: "code", value }}
      path={`${path}/${childPath}`}
    />
  );
  const renderImage = (url: string, alt: string, dimensions?: MarkupImageDimensions) => (
    <MarkdownImage
      alt={alt}
      reveal={animateStreaming}
      url={url}
      {...(dimensions === undefined ? {} : { dimensions })}
    />
  );
  if (html === null) {
    return (
      <CopyableInline style={styles.rawHtml} value={node.value}>
        {node.value}
      </CopyableInline>
    );
  }
  return <NativeMarkup code={renderCode} html={html} image={renderImage} link={renderMarkupLink} />;
}

function renderMarkupLink(url: string, children: ReactNode): ReactNode {
  return <MarkdownLink url={url}>{children}</MarkdownLink>;
}

function CopyableCodeBlock({ language, value }: { language: string; value: string }) {
  const scale = useContext(RichMarkdownTextScaleContext);
  return <CodeBlock language={language} scale={scale} value={value} />;
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
function MarkdownLink({
  appendIcon = true,
  children,
  url,
}: {
  appendIcon?: boolean;
  children: ReactNode;
  url: string;
}) {
  const dialog = useAppDialog();
  const openLocalLink = useMarkdownLocalLinkHandler();
  const openWebLink = useContext(MarkdownWebLinkContext);
  const external = isSafeLink(url);
  const openLink = external ? (openWebLink ?? openLocalLink) : openLocalLink;
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
        if (openLink?.(url) === true) {
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
      {appendIcon && (external || localKind === "download") && " "}
      {appendIcon && external && (
        <Ionicons color={colors.accent} name="open-outline" size={iconSize.indicator} />
      )}
      {appendIcon && localKind === "download" && (
        <Ionicons color={colors.accent} name="download-outline" size={iconSize.indicator} />
      )}
    </Text>
  );
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

function MarkdownTable({
  completedChat = false,
  documentRoot,
  path,
  table,
}: {
  completedChat?: boolean;
  documentRoot: boolean;
  path: string;
  table: Table;
}) {
  const chatWidth$ = useContext(ChatTableWidthContext);
  // A recycled top-level chat table already has its pane allocation before its first onLayout.
  const initialWidth = useSelector(() => (documentRoot ? (chatWidth$?.get() ?? 0) : 0));
  const viewport = useTableViewport(initialWidth);
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  const minimumWidth = viewport.contentWidth;
  const { cellWidth, tableWidth } = markdownTableLayout(minimumWidth, columnCount);
  const rows = <MarkdownTableRows cellWidth={cellWidth} path={path} table={table} />;
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
          {completedChat ? (
            <NativeMarkdownTable table={table} width={tableWidth}>
              {rows}
            </NativeMarkdownTable>
          ) : (
            rows
          )}
        </View>
      </HorizontalScrollView>
    </View>
  );
}

function MarkdownTableRows({
  cellWidth,
  path,
  table,
}: {
  cellWidth: number;
  path: string;
  table: Table;
}) {
  const animateStreaming = useContext(RichMarkdownRevealContext);
  // Append-only coordinates preserve identity for cells without offsets or with duplicate text.
  return table.children.map((row, rowIndex) => {
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
  });
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
  const highlight = useContext(SearchHighlightQuery) !== "";
  return (
    <Text
      style={[
        styles.tableCell,
        header && styles.tableCellHeader,
        { textAlign: align ?? "left", width },
      ]}
    >
      {inline(cell.children, highlight)}
    </Text>
  );
}

function inline(nodes: PhrasingContent[], highlight: boolean, insideLink = false): ReactNode[] {
  const occurrences = new Map<string, number>();
  return nodes.map((node) => {
    if (node.type === "text" && !highlight) {
      return node.value;
    }
    const key = markdownNodeKey(occurrences, node);
    switch (node.type) {
      case "text":
        return <HighlightSearchText key={key} text={node.value} />;
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {inline(node.children, highlight, insideLink)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} style={styles.emphasis}>
            {inline(node.children, highlight, insideLink)}
          </Text>
        );
      case "delete":
        return (
          <Text key={key} style={styles.deleted}>
            {inline(node.children, highlight, insideLink)}
          </Text>
        );
      case "inlineCode":
        return insideLink ? (
          <Text key={key} style={styles.inlineCode}>
            {highlightedInlineValue(node.value, highlight)}
          </Text>
        ) : (
          <CopyableInline key={key} style={styles.inlineCode} value={node.value}>
            {highlightedInlineValue(node.value, highlight)}
          </CopyableInline>
        );
      case "break":
        return "\n";
      case "link": {
        return (
          <MarkdownLink key={key} url={node.url}>
            {inline(node.children, highlight, true)}
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
        return <Text key={key}>{inline(node.children, highlight)}</Text>;
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

function highlightedInlineValue(text: string, highlight: boolean): ReactNode {
  return highlight ? <HighlightSearchText text={text} /> : text;
}

function markdownNodeKey(occurrences: Map<string, number>, node: Nodes): string {
  return occurrenceKey(occurrences, markdownNodeIdentity(node, fallbackText(node)));
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
    gap: richMarkdownGeometry.alertGap,
    minWidth: 0,
    paddingHorizontal: richMarkdownGeometry.alertPaddingHorizontal,
    paddingVertical: richMarkdownGeometry.alertPaddingVertical,
    width: "100%",
  },
  alertBody: {
    gap: richMarkdownGeometry.blockGap,
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
    borderLeftWidth: spacing.optical,
    gap: richMarkdownGeometry.blockGap,
    paddingLeft: spacing.xs,
  },
  copyHintDone: { color: colors.green },
  deleted: {
    color: colors.textMuted,
    textDecorationLine: "line-through",
  },
  document: {
    gap: richMarkdownGeometry.blockGap,
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
    marginTop: richMarkdownGeometry.headingMarginTop,
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
  // A list spans its parent so an item's body has the parent's width to give a
  // block that takes all of it (a code block scrolls its lines and has no
  // width of its own); in a bubble the parent's width is still its content's.
  list: {
    alignSelf: "stretch",
    gap: richMarkdownGeometry.listGap,
    minWidth: 0,
  },
  listBody: {
    flexGrow: 1,
    flexShrink: 1,
    gap: richMarkdownGeometry.listBodyGap,
    minWidth: 0,
  },
  listMarker: {
    color: colors.textMuted,
    marginStart: -richMarkdownGeometry.listInset,
    textAlign: "right",
    width: richMarkdownGeometry.listMarkerWidth,
    ...typeScale.body,
  },
  listRow: {
    alignItems: "flex-start",
    alignSelf: "stretch",
    flexDirection: "row",
    gap: richMarkdownGeometry.listRowGap,
    minWidth: 0,
    // Reserve the marker gutter during intrinsic text measurement. Both markers hang
    // into this padding, so the final wrap width also determines the row's height.
    paddingStart: richMarkdownGeometry.listInset,
  },
  localImageLink: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    paddingVertical: richMarkdownGeometry.localImageVerticalPadding,
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
  premeasuredHeading: { marginTop: richMarkdownGeometry.headingMarginTop },
  premeasuredLine: { marginTop: 0 },
  rawHtml: {
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  rule: { height: richMarkdownGeometry.ruleHeight },
  secondary: { color: colors.textMuted },
  strong: { fontWeight: typeWeight.semibold },
  table: {
    alignSelf: "flex-start",
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: richMarkdownGeometry.tableBorderWidth,
    overflow: "hidden",
  },
  tableCell: {
    borderRightColor: colors.borderSoft,
    borderRightWidth: richMarkdownGeometry.tableBorderWidth,
    color: colors.text,
    flexShrink: 0,
    minWidth: 144,
    paddingHorizontal: richMarkdownGeometry.tableCellPaddingHorizontal,
    paddingVertical: richMarkdownGeometry.tableCellPaddingVertical,
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
    borderBottomWidth: richMarkdownGeometry.tableRowBorderWidth,
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
    marginStart: -richMarkdownGeometry.listInset,
    minHeight: typeScale.body.lineHeight,
    width: richMarkdownGeometry.listMarkerWidth,
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
