import { isSafeLink } from "@codewide/rendering-core";
import type { Blockquote, PhrasingContent, RootContent } from "mdast";
import {
  prepareInlineFlow,
  validateFont,
  verifyFontsLoaded,
  walkInlineFlowLines,
  type InlineFlowItem,
  type TextStyle,
} from "expo-pretext";

import { iconSize, layoutSize, spacing, typeScale } from "../theme";
import { productFonts } from "../ui/product-fonts";
import { looksLikeAsciiDiagram } from "./ascii-diagram";
import { isRemoteFileHref, remoteFileKind } from "./document-preview";
import { safeImageUri } from "./image-source";
import {
  INLINE_MEDIA_PREVIEW_HEIGHT,
  MAX_INLINE_DIAGRAM_SOURCE_CHARS,
} from "./inlineMediaGeometry";
import { nativeCodeHeight, nativeCodePreview } from "./native-code-block";
import { markdownTableLayout } from "./markdown-table-layout";

/** Renderer-owned dimensions consumed by both React Native views and their premeasurement. */
export const richMarkdownGeometry = {
  alertBodyInset: spacing.xs + spacing.xs,
  alertGap: spacing.xxs,
  alertHeaderHeight: typeScale.label.lineHeight,
  alertPaddingHorizontal: spacing.xs,
  alertPaddingVertical: spacing.xs,
  blockGap: spacing.xxs,
  blockquoteInset: spacing.xs + spacing.optical,
  codeBorderWidth: 1,
  codeGap: spacing.xxs,
  codePadding: spacing.xs,
  diagramFallbackPaddingVertical: spacing.xxs,
  diagramHeaderHeight: layoutSize.header,
  diagramPreviewHeight: INLINE_MEDIA_PREVIEW_HEIGHT,
  headingMarginTop: spacing.xxs,
  listBodyGap: spacing.optical,
  listGap: spacing.xxs,
  listInset: typeScale.body.lineHeight + spacing.compact,
  listMarkerWidth: typeScale.body.lineHeight,
  listRowGap: spacing.compact,
  localImageVerticalPadding: spacing.xxs,
  ruleHeight: spacing.xs,
  tableBorderWidth: 1,
  tableCellPaddingHorizontal: spacing.xs,
  tableCellPaddingVertical: spacing.xxs,
  tableRowBorderWidth: 1,
} as const;

const DOWNLOAD_LINK_GLYPH = "\uF2BA";
const OPEN_LINK_GLYPH = "\uF488";
const ESTIMATED_GLYPH_WIDTH_RATIO = 0.56;
const HORIZONTAL_SIDES = 2;
const HTML_IMAGE_TAG_PREFIX = "<img";
const HEADING_TYPOGRAPHY_BY_DEPTH: Readonly<
  Record<string, (typeof typeScale)[keyof typeof typeScale]>
> = {
  "1": typeScale.heading,
  "2": typeScale.title,
  "3": typeScale.body,
  "4": typeScale.body,
  "5": typeScale.body,
  "6": typeScale.body,
};

export type RichMarkdownDynamicHeightReason =
  | "html"
  | "measurement-error"
  | "measurement-unavailable"
  | "table"
  | "unsupported-node";

export type RichMarkdownBlockHeight =
  | { readonly height: number; readonly status: "exact" }
  | { readonly reason: RichMarkdownDynamicHeightReason; readonly status: "dynamic" };

export type RichMarkdownHeightGeometry = Readonly<{
  fontScale: number;
  hiddenImageReferences: ReadonlySet<string>;
  width: number;
}>;

type InlineTypography = Readonly<{
  fontFamily: string;
  fontScale: number;
  fontSize: number;
  lineHeight: number;
}>;

type InlineRunInteraction =
  | { readonly kind: "copy"; readonly value: string }
  | { readonly kind: "link"; readonly url: string }
  | null;

type InlineContentPresentation = Readonly<{
  decoration: "line-through" | "none";
  icon: null;
  interaction: InlineRunInteraction;
  tone: "code" | "link" | "primary" | "secondary";
}>;

type InlineRunPresentation =
  | InlineContentPresentation
  | Readonly<{
      decoration: "line-through" | "none";
      icon: "download" | "external";
      interaction: Extract<InlineRunInteraction, { kind: "link" }>;
      tone: "link";
    }>;

type InlineStyleState = Readonly<{
  fontFamily: string;
  fontScale: number;
  fontSize: number;
  fontStyle: "italic" | "normal";
  fontWeight: "400";
  lineHeight: number;
  presentation: InlineContentPresentation;
}>;

/** One styled semantic run shared by Pretext measurement and rendering. */
export type RichMarkdownInlineRun = Readonly<{
  flow: InlineFlowItem;
  presentation: InlineRunPresentation;
}>;

type RichMarkdownInlineFragment = Readonly<{
  run: RichMarkdownInlineRun;
  text: string;
}>;

/** One Pretext-owned visual line, including its offset in the flattened review text. */
type RichMarkdownInlineLine = Readonly<{
  fragments: readonly RichMarkdownInlineFragment[];
  reviewOffset: number;
}>;

/** Cached line layout or the bounded reason it cannot own the row. */
export type RichMarkdownInlineLayout =
  | {
      readonly lines: readonly RichMarkdownInlineLine[];
      readonly status: "exact";
    }
  | { readonly reason: RichMarkdownDynamicHeightReason; readonly status: "dynamic" };

type InlineFlowProjection =
  | { readonly groups: readonly (readonly RichMarkdownInlineRun[])[]; readonly status: "exact" }
  | { readonly reason: RichMarkdownDynamicHeightReason; readonly status: "dynamic" };

type InlineFlowBuilder = {
  groups: RichMarkdownInlineRun[][];
};

type InlineProjectionContext = Readonly<{
  builder: InlineFlowBuilder;
  typography: InlineTypography;
}>;

const confirmedFonts = new Set<string>();
const inlineLayoutCache = new WeakMap<
  readonly PhrasingContent[],
  Map<string, RichMarkdownInlineLayout>
>();

/** Measures one renderer-owned Markdown root block without mounting React Native views. */
export function measureRichMarkdownBlock(
  node: RootContent,
  geometry: RichMarkdownHeightGeometry,
): RichMarkdownBlockHeight {
  if (!Number.isFinite(geometry.width) || geometry.width <= 0) {
    return dynamicHeight("measurement-unavailable");
  }
  try {
    return measureBlock(node, geometry);
  } catch {
    return dynamicHeight("measurement-error");
  }
}

/** Estimates only renderer shapes whose final height still depends on native or local state. */
export function estimateDynamicRichMarkdownBlock(
  node: RootContent,
  geometry: RichMarkdownHeightGeometry,
): number {
  const width = Math.max(1, geometry.width);
  if (node.type === "table") {
    return estimateTableHeight(node, geometry.fontScale, width);
  }
  if (node.type === "html") {
    return estimateHtmlHeight(node.value, geometry.fontScale, width);
  }
  if (node.type === "footnoteDefinition") {
    return estimateBlockChildren(node.children, geometry);
  }
  return estimateTextHeight({
    fontSize: typeScale.body.fontSize * geometry.fontScale,
    lineHeight: typeScale.body.lineHeight * geometry.fontScale,
    text: rootContentText(node),
    width,
  });
}

/** Extracts GitHub alert metadata while preserving the renderer's remaining child nodes. */
// WHY: Alert projection must validate and rewrite the first child atomically to preserve paths.
// oxlint-disable-next-line eslint/complexity
export function projectMarkdownAlert(
  node: Blockquote,
): { readonly children: readonly RootContent[]; readonly kind: MarkdownAlertKind } | null {
  const first = node.children[0];
  if (first?.type !== "paragraph") {
    return null;
  }
  const firstInline = first.children[0];
  if (firstInline?.type !== "text") {
    return null;
  }
  const match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+|$)/iu.exec(firstInline.value);
  const kind = markdownAlertKind(match?.[1]);
  if (match === null || kind === null) {
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
  return { children, kind };
}

export type MarkdownAlertKind = "CAUTION" | "IMPORTANT" | "NOTE" | "TIP" | "WARNING";

// WHY: This is the exhaustive MDAST root dispatcher; splitting it would duplicate node ownership.
// oxlint-disable-next-line eslint/complexity, typescript/consistent-return
function measureBlock(
  node: RootContent,
  geometry: RichMarkdownHeightGeometry,
): RichMarkdownBlockHeight {
  switch (node.type) {
    case "paragraph": {
      const only = node.children[0];
      if (node.children.length === 1 && only?.type === "image") {
        return measureMarkdownImage(only.alt ?? "Image", only.url, geometry);
      }
      if (
        node.children.length === 1 &&
        only?.type === "link" &&
        only.children.length === 1 &&
        only.children[0]?.type === "image"
      ) {
        const image = only.children[0];
        return measureMarkdownImage(image.alt ?? "Image", image.url, geometry);
      }
      return measureInline(node.children, bodyTypography(geometry.fontScale), geometry.width);
    }
    case "heading": {
      const measured = measureInline(
        node.children,
        headingTypography(node.depth, geometry.fontScale),
        geometry.width,
      );
      return measured.status === "dynamic"
        ? measured
        : exactHeight(measured.height + richMarkdownGeometry.headingMarginTop);
    }
    case "blockquote":
      return measureBlockquote(node, geometry);
    case "list":
      return measureList(node, geometry);
    case "code":
      return measureCode(node.value, node.lang, geometry.fontScale);
    case "thematicBreak":
      return exactHeight(richMarkdownGeometry.ruleHeight);
    case "definition":
    case "yaml":
      return exactHeight(0);
    case "html":
      return dynamicHeight("html");
    case "table":
      return dynamicHeight("table");
    case "footnoteDefinition":
      return dynamicHeight("unsupported-node");
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
      return dynamicHeight("unsupported-node");
  }
}

function measureBlockquote(
  node: Blockquote,
  geometry: RichMarkdownHeightGeometry,
): RichMarkdownBlockHeight {
  const alert = projectMarkdownAlert(node);
  if (alert === null) {
    return measureBlockStack(
      node.children,
      {
        ...geometry,
        width: geometry.width - richMarkdownGeometry.blockquoteInset,
      },
      richMarkdownGeometry.blockGap,
    );
  }
  const body = measureBlockStack(
    alert.children,
    { ...geometry, width: geometry.width - richMarkdownGeometry.alertBodyInset },
    richMarkdownGeometry.blockGap,
  );
  if (body.status === "dynamic") {
    return body;
  }
  const headerHeight = Math.max(
    iconSize.inline,
    richMarkdownGeometry.alertHeaderHeight * geometry.fontScale,
  );
  const bodyGap = body.height > 0 ? richMarkdownGeometry.alertGap : 0;
  return exactHeight(
    richMarkdownGeometry.alertPaddingVertical +
      richMarkdownGeometry.alertPaddingVertical +
      headerHeight +
      bodyGap +
      body.height,
  );
}

function measureList(
  node: Extract<RootContent, { type: "list" }>,
  geometry: RichMarkdownHeightGeometry,
): RichMarkdownBlockHeight {
  const rowHeights: number[] = [];
  for (let index = 0; index < node.children.length; index += 1) {
    const item = node.children[index];
    if (item === undefined) {
      continue;
    }
    const body = measureBlockStack(
      item.children,
      { ...geometry, width: geometry.width - richMarkdownGeometry.listInset },
      richMarkdownGeometry.listBodyGap,
    );
    if (body.status === "dynamic") {
      return body;
    }
    const marker =
      typeof item.checked === "boolean"
        ? exactHeight(Math.max(iconSize.inline, typeScale.body.lineHeight))
        : measureInline(
            [
              {
                type: "text",
                value: node.ordered === true ? `${String((node.start ?? 1) + index)}.` : "•",
              },
            ],
            bodyTypography(geometry.fontScale),
            richMarkdownGeometry.listMarkerWidth,
          );
    if (marker.status === "dynamic") {
      return marker;
    }
    rowHeights.push(Math.max(marker.height, body.height));
  }
  return exactHeight(sumWithGap(rowHeights, richMarkdownGeometry.listGap));
}

function measureBlockStack(
  nodes: readonly RootContent[],
  geometry: RichMarkdownHeightGeometry,
  gap: number,
): RichMarkdownBlockHeight {
  const heights: number[] = [];
  for (const node of nodes) {
    const measured = measureBlock(node, geometry);
    if (measured.status === "dynamic") {
      return measured;
    }
    if (measured.height > 0) {
      heights.push(measured.height);
    }
  }
  return exactHeight(sumWithGap(heights, gap));
}

function measureCode(
  value: string,
  language: string | null | undefined,
  fontScale: number,
): RichMarkdownBlockHeight {
  const resolvedLanguage = language ?? "text";
  const diagram =
    resolvedLanguage.toLocaleLowerCase() === "mermaid" || looksLikeAsciiDiagram(value, language);
  if (diagram) {
    if (value.length <= MAX_INLINE_DIAGRAM_SOURCE_CHARS) {
      return exactHeight(
        richMarkdownGeometry.diagramHeaderHeight + richMarkdownGeometry.diagramPreviewHeight,
      );
    }
    const fallbackChrome =
      richMarkdownGeometry.diagramHeaderHeight +
      richMarkdownGeometry.diagramFallbackPaddingVertical +
      richMarkdownGeometry.diagramFallbackPaddingVertical;
    if (resolvedLanguage.toLocaleLowerCase() === "mermaid") {
      return exactHeight(fallbackChrome);
    }
    const preview = nativeCodePreview(value);
    const truncationHeight = preview.truncated
      ? richMarkdownGeometry.codeGap + typeScale.caption.lineHeight * fontScale
      : 0;
    return exactHeight(fallbackChrome + nativeCodeHeight(preview.value) + truncationHeight);
  }
  const preview = nativeCodePreview(value);
  const headerHeight = typeScale.caption.lineHeight * fontScale;
  const truncationHeight = preview.truncated
    ? richMarkdownGeometry.codeGap + typeScale.caption.lineHeight * fontScale
    : 0;
  return exactHeight(
    richMarkdownGeometry.codeBorderWidth +
      richMarkdownGeometry.codeBorderWidth +
      richMarkdownGeometry.codePadding +
      richMarkdownGeometry.codePadding +
      headerHeight +
      richMarkdownGeometry.codeGap +
      nativeCodeHeight(preview.value) +
      truncationHeight,
  );
}

function measureMarkdownImage(
  alt: string,
  url: string,
  geometry: RichMarkdownHeightGeometry,
): RichMarkdownBlockHeight {
  if (geometry.hiddenImageReferences.has(url)) {
    return exactHeight(0);
  }
  if (safeImageUri(url) !== null) {
    return exactHeight(INLINE_MEDIA_PREVIEW_HEIGHT);
  }
  if (isRemoteFileHref(url) && remoteFileKind(alt, url) === "image") {
    return exactHeight(
      Math.max(iconSize.inline, typeScale.body.lineHeight * geometry.fontScale) +
        richMarkdownGeometry.localImageVerticalPadding +
        richMarkdownGeometry.localImageVerticalPadding,
    );
  }
  return measureInline(
    [{ type: "text", value: `[Image: ${alt}]` }],
    bodyTypography(geometry.fontScale),
    geometry.width,
  );
}

function measureInline(
  nodes: readonly PhrasingContent[],
  typography: InlineTypography,
  width: number,
): RichMarkdownBlockHeight {
  const layout = layoutInline(nodes, typography, width);
  return layout.status === "dynamic"
    ? layout
    : exactHeight(layout.lines.length * typography.lineHeight);
}

/** Resolves the same cached Pretext lines consumed by measurement and timeline rendering. */
export function layoutRichMarkdownInline(
  node: Extract<RootContent, { type: "heading" | "paragraph" }>,
  geometry: Pick<RichMarkdownHeightGeometry, "fontScale" | "width">,
): RichMarkdownInlineLayout {
  const typography =
    node.type === "heading"
      ? headingTypography(node.depth, geometry.fontScale)
      : bodyTypography(geometry.fontScale);
  return layoutInline(node.children, typography, geometry.width);
}

function layoutInline(
  nodes: readonly PhrasingContent[],
  typography: InlineTypography,
  width: number,
): RichMarkdownInlineLayout {
  const key = [
    typography.fontFamily,
    typography.fontSize,
    typography.lineHeight,
    typography.fontScale,
    width,
  ].join(":");
  const cached = inlineLayoutCache.get(nodes)?.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const projected = projectInlineFlow(nodes, typography);
  if (projected.status === "dynamic") {
    return projected;
  }
  if (!ensureInlineFonts(projected.groups)) {
    return dynamicInlineLayout("measurement-unavailable");
  }
  const layout = { lines: buildInlineLines(projected.groups, width), status: "exact" as const };
  const cache = inlineLayoutCache.get(nodes) ?? new Map<string, RichMarkdownInlineLayout>();
  cache.set(key, layout);
  inlineLayoutCache.set(nodes, cache);
  return layout;
}

function buildInlineLines(
  groups: readonly (readonly RichMarkdownInlineRun[])[],
  width: number,
): RichMarkdownInlineLine[] {
  const lines: RichMarkdownInlineLine[] = [];
  let reviewOffset = 0;
  const explicitLines = groups.length > 1;
  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) {
      reviewOffset += 1;
    }
    if (group.length === 0) {
      if (explicitLines) {
        lines.push({ fragments: [], reviewOffset });
      }
      continue;
    }
    const flow = group.map((run) => run.flow);
    walkInlineFlowLines(prepareInlineFlow(flow), width, (line) => {
      const lineReviewOffset = reviewOffset;
      const fragments = line.fragments.map((fragment) => {
        const run = group[fragment.itemIndex];
        if (run === undefined) {
          throw new Error("Pretext inline fragment lost its source run");
        }
        const text = `${fragment.gapBefore > 0 ? " " : ""}${fragment.text}`;
        reviewOffset += text.length;
        return { run, text };
      });
      lines.push({ fragments, reviewOffset: lineReviewOffset });
    });
  }
  return lines;
}

function projectInlineFlow(
  nodes: readonly PhrasingContent[],
  typography: InlineTypography,
): InlineFlowProjection {
  const builder: InlineFlowBuilder = { groups: [[]] };
  const context = { builder, typography };
  const result = appendInlineNodes(context, nodes, inlineRootStyle(typography));
  return result === null ? { groups: builder.groups, status: "exact" } : dynamicInline(result);
}

// WHY: Inline MDAST nodes must be projected in one ordered traversal so adjacent style runs wrap
// exactly like the nested React Native Text tree.
// oxlint-disable-next-line eslint/complexity
function appendInlineNodes(
  context: InlineProjectionContext,
  nodes: readonly PhrasingContent[],
  state: InlineStyleState,
): RichMarkdownDynamicHeightReason | null {
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        appendInlineText(context.builder, {
          presentation: state.presentation,
          style: pretextStyle(state),
          text: node.value,
        });
        break;
      case "break":
        appendInlineText(context.builder, {
          presentation: state.presentation,
          style: pretextStyle(state),
          text: "\n",
        });
        break;
      case "strong": {
        const reason = appendInlineNodes(context, node.children, {
          ...state,
          fontFamily: productFonts.semibold,
          fontWeight: "400",
        });
        if (reason !== null) {
          return reason;
        }
        break;
      }
      case "emphasis": {
        const reason = appendInlineNodes(context, node.children, {
          ...state,
          fontFamily: productFonts.regular,
          fontStyle: "italic",
          fontWeight: "400",
        });
        if (reason !== null) {
          return reason;
        }
        break;
      }
      case "delete": {
        const reason = appendInlineNodes(context, node.children, {
          ...state,
          fontFamily: productFonts.regular,
          fontWeight: "400",
          presentation: { ...state.presentation, decoration: "line-through" },
        });
        if (reason !== null) {
          return reason;
        }
        break;
      }
      case "inlineCode":
        appendInlineText(context.builder, {
          presentation:
            state.presentation.interaction?.kind === "link"
              ? { ...state.presentation, tone: "code" }
              : {
                  ...state.presentation,
                  interaction: { kind: "copy", value: node.value },
                  tone: "code",
                },
          style: pretextStyle({ ...state, fontFamily: "monospace" }),
          text: node.value,
        });
        break;
      case "link": {
        const linkState = {
          ...state,
          fontFamily: productFonts.regular,
          fontWeight: "400" as const,
          presentation: {
            ...state.presentation,
            interaction: { kind: "link" as const, url: node.url },
            tone: "link" as const,
          },
        };
        const reason = appendInlineNodes(context, node.children, linkState);
        if (reason !== null) {
          return reason;
        }
        const icon = inlineLinkIcon(node.url);
        if (icon !== null) {
          appendInlineText(context.builder, {
            presentation: linkState.presentation,
            style: pretextStyle(linkState),
            text: " ",
          });
          appendInlineItem(context.builder, {
            flow: {
              atomic: true,
              style: iconStyle(context.typography),
              text: icon,
            },
            presentation: {
              ...linkState.presentation,
              icon: isSafeLink(node.url) ? "external" : "download",
            },
          });
        }
        break;
      }
      case "linkReference": {
        const reason = appendInlineNodes(context, node.children, {
          ...state,
          fontFamily: productFonts.regular,
          fontWeight: "400",
        });
        if (reason !== null) {
          return reason;
        }
        break;
      }
      case "image":
        appendInlineText(context.builder, {
          presentation: { ...state.presentation, tone: "secondary" },
          style: secondaryInlineStyle(state),
          text: `[Image: ${node.alt ?? node.url}]`,
        });
        break;
      case "imageReference":
        appendInlineText(context.builder, {
          presentation: { ...state.presentation, tone: "secondary" },
          style: secondaryInlineStyle(state),
          text: `[Image: ${node.alt ?? node.identifier}]`,
        });
        break;
      case "footnoteReference":
        appendInlineText(context.builder, {
          presentation: { ...state.presentation, tone: "secondary" },
          style: secondaryInlineStyle(state),
          text: `[${node.identifier}]`,
        });
        break;
      case "html":
        appendInlineText(context.builder, {
          presentation: { ...state.presentation, tone: "secondary" },
          style: pretextStyle({
            ...state,
            fontFamily: "monospace",
            fontSize: typeScale.code.fontSize * state.fontScale,
            lineHeight: typeScale.code.lineHeight * state.fontScale,
          }),
          text: node.value,
        });
        break;
      default:
        return "unsupported-node";
    }
  }
  return null;
}

function appendInlineText(
  builder: InlineFlowBuilder,
  input: Readonly<{
    presentation: InlineContentPresentation;
    style: TextStyle;
    text: string;
  }>,
): void {
  const parts = input.text.split("\n");
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part !== undefined && part !== "") {
      appendInlineItem(builder, {
        flow: { style: input.style, text: part },
        presentation: input.presentation,
      });
    }
    if (index < parts.length - 1) {
      builder.groups.push([]);
    }
  }
}

function appendInlineItem(builder: InlineFlowBuilder, item: RichMarkdownInlineRun): void {
  const group = builder.groups.at(-1);
  if (group !== undefined) {
    group.push(item);
  }
}

function inlineLinkIcon(url: string): string | null {
  if (isSafeLink(url)) {
    return OPEN_LINK_GLYPH;
  }
  return isRemoteFileHref(url) && remoteFileKind(url, url) === "download"
    ? DOWNLOAD_LINK_GLYPH
    : null;
}

function inlineRootStyle(typography: InlineTypography): InlineStyleState {
  return {
    fontFamily: typography.fontFamily,
    fontScale: typography.fontScale,
    fontSize: typography.fontSize,
    fontStyle: "normal",
    fontWeight: "400",
    lineHeight: typography.lineHeight,
    presentation: {
      decoration: "none",
      icon: null,
      interaction: null,
      tone: "primary",
    },
  };
}

function secondaryInlineStyle(state: InlineStyleState): TextStyle {
  return pretextStyle({ ...state, fontFamily: productFonts.regular, fontWeight: "400" });
}

function pretextStyle(state: InlineStyleState): TextStyle {
  return {
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    fontStyle: state.fontStyle,
    fontWeight: state.fontWeight,
    lineHeight: state.lineHeight,
  };
}

function iconStyle(typography: InlineTypography): TextStyle {
  return {
    fontFamily: "ionicons",
    fontSize: iconSize.indicator,
    fontWeight: "400",
    lineHeight: typography.lineHeight,
  };
}

function ensureInlineFonts(groups: readonly (readonly RichMarkdownInlineRun[])[]): boolean {
  for (const group of groups) {
    for (const { flow: item } of group) {
      const family = typeof item.style.fontFamily === "string" ? item.style.fontFamily : null;
      if (family === null || !ensureFont(family, item.style, item.text)) {
        return false;
      }
    }
  }
  return true;
}

function estimateTableHeight(
  table: Extract<RootContent, { type: "table" }>,
  fontScale: number,
  width: number,
): number {
  const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
  const { cellWidth } = markdownTableLayout(width, columnCount);
  const cellContentWidth = Math.max(
    1,
    cellWidth -
      richMarkdownGeometry.tableCellPaddingHorizontal * HORIZONTAL_SIDES -
      richMarkdownGeometry.tableBorderWidth,
  );
  let height = richMarkdownGeometry.tableBorderWidth * HORIZONTAL_SIDES;
  for (const row of table.children) {
    let rowHeight = typeScale.label.lineHeight * fontScale;
    for (const cell of row.children) {
      rowHeight = Math.max(
        rowHeight,
        estimateTextHeight({
          fontSize: typeScale.label.fontSize * fontScale,
          lineHeight: typeScale.label.lineHeight * fontScale,
          text: phrasingContentText(cell.children),
          width: cellContentWidth,
        }),
      );
    }
    height +=
      rowHeight +
      richMarkdownGeometry.tableCellPaddingVertical * HORIZONTAL_SIDES +
      richMarkdownGeometry.tableRowBorderWidth;
  }
  return height;
}

function estimateHtmlHeight(value: string, fontScale: number, width: number): number {
  let imageCount = 0;
  let cursor = 0;
  const lower = value.toLocaleLowerCase();
  while ((cursor = lower.indexOf(HTML_IMAGE_TAG_PREFIX, cursor)) >= 0) {
    imageCount += 1;
    cursor += HTML_IMAGE_TAG_PREFIX.length;
  }
  const visibleText = value.replaceAll(/<[^>]*>/gu, " ");
  const textHeight = estimateTextHeight({
    fontSize: typeScale.code.fontSize * fontScale,
    lineHeight: typeScale.code.lineHeight * fontScale,
    text: visibleText,
    width,
  });
  return (
    Math.max(typeScale.code.lineHeight * fontScale, textHeight) +
    imageCount * INLINE_MEDIA_PREVIEW_HEIGHT
  );
}

function estimateBlockChildren(
  nodes: readonly RootContent[],
  geometry: RichMarkdownHeightGeometry,
): number {
  let height = 0;
  let visibleBlocks = 0;
  for (const node of nodes) {
    const measured = measureRichMarkdownBlock(node, geometry);
    const blockHeight =
      measured.status === "exact"
        ? measured.height
        : estimateDynamicRichMarkdownBlock(node, geometry);
    if (blockHeight > 0) {
      height += blockHeight;
      visibleBlocks += 1;
    }
  }
  return height + Math.max(0, visibleBlocks - 1) * richMarkdownGeometry.blockGap;
}

function estimateTextHeight(options: {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly text: string;
  readonly width: number;
}): number {
  const { fontSize, lineHeight, text, width } = options;
  const charactersPerLine = Math.max(
    1,
    Math.floor(width / Math.max(1, fontSize * ESTIMATED_GLYPH_WIDTH_RATIO)),
  );
  let lineCount = 0;
  for (const line of text.split("\n")) {
    lineCount += Math.max(1, Math.ceil(line.length / charactersPerLine));
  }
  return Math.max(1, lineCount) * lineHeight;
}

function rootContentText(node: RootContent): string {
  return contentNodeText(node);
}

function phrasingContentText(nodes: readonly PhrasingContent[]): string {
  let text = "";
  for (const node of nodes) {
    text += contentNodeText(node);
  }
  return text;
}

function contentNodeText(node: RootContent | PhrasingContent): string {
  if ("value" in node && typeof node.value === "string") {
    return node.value;
  }
  if ("alt" in node && typeof node.alt === "string") {
    return node.alt;
  }
  if (!("children" in node)) {
    return "";
  }
  let text = "";
  for (const child of node.children) {
    text += contentNodeText(child);
    text += " ";
  }
  return text;
}

function ensureFont(fontFamily: string, style: TextStyle, reference: string): boolean {
  const key = `${fontFamily}:${String(style.fontSize)}:${style.fontStyle ?? "normal"}`;
  if (confirmedFonts.has(key)) {
    return true;
  }
  if (!validateFont(fontFamily)) {
    return false;
  }
  const verification = verifyFontsLoaded(
    { ...style, fontFamily },
    fontFamily === "ionicons" ? { reference } : undefined,
  );
  if (verification?.applied !== true) {
    return false;
  }
  confirmedFonts.add(key);
  return true;
}

function bodyTypography(fontScale: number): InlineTypography {
  return {
    fontFamily: productFonts.regular,
    fontScale,
    fontSize: typeScale.body.fontSize * fontScale,
    lineHeight: typeScale.body.lineHeight * fontScale,
  };
}

function headingTypography(
  depth: Extract<RootContent, { type: "heading" }>["depth"],
  fontScale: number,
): InlineTypography {
  const scale = HEADING_TYPOGRAPHY_BY_DEPTH[String(depth)] ?? typeScale.body;
  return {
    fontFamily: productFonts.semibold,
    fontScale,
    fontSize: scale.fontSize * fontScale,
    lineHeight: scale.lineHeight * fontScale,
  };
}

function markdownAlertKind(value: string | undefined): MarkdownAlertKind | null {
  const normalized = value?.toUpperCase();
  return normalized === "CAUTION" ||
    normalized === "IMPORTANT" ||
    normalized === "NOTE" ||
    normalized === "TIP" ||
    normalized === "WARNING"
    ? normalized
    : null;
}

function sumWithGap(values: readonly number[], gap: number): number {
  return values.reduce((sum, value) => sum + value, 0) + Math.max(0, values.length - 1) * gap;
}

function exactHeight(height: number): RichMarkdownBlockHeight {
  return Number.isFinite(height) && height >= 0
    ? { height, status: "exact" }
    : dynamicHeight("measurement-error");
}

function dynamicHeight(reason: RichMarkdownDynamicHeightReason): RichMarkdownBlockHeight {
  return { reason, status: "dynamic" };
}

function dynamicInline(reason: RichMarkdownDynamicHeightReason): InlineFlowProjection {
  return { reason, status: "dynamic" };
}

function dynamicInlineLayout(reason: RichMarkdownDynamicHeightReason): RichMarkdownInlineLayout {
  return { reason, status: "dynamic" };
}
