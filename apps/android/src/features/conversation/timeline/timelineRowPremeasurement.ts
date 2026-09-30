import { performanceExperimentEnabled } from "../../../data/performance-experiments";
import type { TimelineFixedSizeFallbackReason } from "../../../data/timelineScrollDiagnosticContract";
import { artifactImageReferences } from "../../../rendering/ArtifactImageReferences";
import {
  estimateDynamicRichMarkdownBlock,
  measureRichMarkdownBlock,
  type RichMarkdownDynamicHeightReason,
} from "../../../rendering/richMarkdownGeometry";
import { selectTurnRenderWindow } from "../../../rendering/thread-render-window";
import { controlSize, iconSize, spacing, typeScale } from "../../../theme";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../../ui/typography-policy";
import { hasCompletedTurnHistory } from "../turns/completedHistoryVisibility";
import { projectTurnPresentation } from "../turns/turnProjection";
import type { VirtualizedTurnPart, VirtualizedTurnPlacement } from "../turns/virtualizedTurnTypes";
import { TIMELINE_ROW_FALLBACK_ESTIMATE, type TimelineRow } from "./timelineRows";

const TIMELINE_ROW_GEOMETRY_VERSION = 4;
const TIMELINE_ROW_GEOMETRY_CACHE_LIMIT = 8;
const HORIZONTAL_SIDES = 2;
const MINIMUM_FONT_SCALE = 0.1;
const TIMELINE_ITEM_MAX_WIDTH = 880;
const AGENT_BUBBLE_HORIZONTAL_CHROME = spacing.md * HORIZONTAL_SIDES + controlSize.compact;
const TIMELINE_HORIZONTAL_CHROME = spacing.md * HORIZONTAL_SIDES;
const NON_TRAILING_MARKDOWN_GAP = spacing.xxs;
const FOLLOWING_LEAD_TOP_GAP = spacing.xxs;
const DATE_SEPARATOR_VERTICAL_PADDING = spacing.sm * HORIZONTAL_SIDES;
const DATE_SEPARATOR_SIBLING_GAP = spacing.xxs;
const ESTIMATED_GLYPH_WIDTH_RATIO = 0.56;
const FOOTER_GAP = spacing.optical;
const FOOTER_MARGIN_BOTTOM = spacing.xs;
const FOOTER_VERTICAL_PADDING = spacing.optical * HORIZONTAL_SIDES;
const USER_BUBBLE_WIDTH_RATIO = 0.82;
const MARKDOWN_DYNAMIC_REASON = {
  html: "markdown-html",
  "measurement-error": "markdown-measurement-error",
  "measurement-unavailable": "markdown-measurement-unavailable",
  table: "markdown-table",
  "unsupported-node": "markdown-unsupported-node",
} as const satisfies Readonly<Record<RichMarkdownDynamicHeightReason, string>>;

export type TimelineRowHeightResult =
  | {
      readonly size: number;
      readonly source: "cache" | "calculated";
      readonly status: "exact";
    }
  | {
      readonly estimate: number;
      readonly reason: TimelineFixedSizeFallbackReason;
      readonly status: "dynamic";
    };

export type TimelineRowMeasurementGeometry = Readonly<{
  agentDateVisible: boolean;
  beforeDateVisible: boolean;
  density: number;
  fontScale: number;
  viewportWidth: number;
}>;

type MeasurableTimelineRow = Extract<TimelineRow, { kind: "turnSlice" }>;
type TimelineRowCandidate =
  | {
      readonly part: Extract<VirtualizedTurnPart, { kind: "markdownBlock" }>;
      readonly row: MeasurableTimelineRow;
      readonly status: "measurable";
    }
  | { readonly reason: TimelineFixedSizeFallbackReason; readonly status: "dynamic" };

const timelineRowSizeCache = new WeakMap<TimelineRow, Map<string, TimelineRowHeightResult>>();

/** Resolves exact physical-row geometry or a bounded reason for native measurement. */
export function timelineRowHeight(
  row: TimelineRow,
  geometry: TimelineRowMeasurementGeometry,
): TimelineRowHeightResult {
  if (!validGeometry(geometry)) {
    return dynamicHeight("invalid-geometry", TIMELINE_ROW_FALLBACK_ESTIMATE);
  }
  const dimensions = timelineMeasurementDimensions(geometry);
  if (dimensions === null) {
    return dynamicHeight("invalid-geometry", TIMELINE_ROW_FALLBACK_ESTIMATE);
  }
  const cacheKey = timelineRowGeometryKey(geometry, dimensions);
  const cached = cachedTimelineRowSize(row, cacheKey);
  if (cached !== undefined) {
    return cached.status === "exact" ? { ...cached, source: "cache" } : cached;
  }
  const candidate = timelineRowCandidate(row);
  const result =
    candidate.status === "dynamic"
      ? estimateDynamicTimelineRow({
          dimensions,
          geometry,
          reason: candidate.reason,
          row,
        })
      : measureTimelineRow({
          dimensions,
          geometry,
          part: candidate.part,
          row: candidate.row,
        });
  rememberTimelineRowSize(row, cacheKey, result);
  return result;
}

function timelineRowCandidate(row: TimelineRow): TimelineRowCandidate {
  if (row.kind !== "turnSlice") {
    return dynamicCandidate("unsupported-row");
  }
  if (performanceExperimentEnabled("plainTextMarkdown")) {
    return dynamicCandidate("performance-experiment");
  }
  if (timelineRowIsStreaming(row)) {
    return dynamicCandidate("streaming");
  }
  const part = singleMarkdownPart(row.parts);
  return part === null ? dynamicCandidate("composite-row") : { part, row, status: "measurable" };
}

function measureTimelineRow(options: {
  readonly dimensions: { readonly contentWidth: number; readonly fontScale: number };
  readonly geometry: TimelineRowMeasurementGeometry;
  readonly part: Extract<VirtualizedTurnPart, { kind: "markdownBlock" }>;
  readonly row: MeasurableTimelineRow;
}): TimelineRowHeightResult {
  const { dimensions, geometry, part, row } = options;
  const { contentWidth, fontScale } = dimensions;
  const presentation = projectTurnPresentation(row.item, null, false, false);
  const presentationReason = dynamicPresentationReason(row, presentation);
  if (presentationReason !== null) {
    return estimateDynamicTimelineRow({ dimensions, geometry, reason: presentationReason, row });
  }
  const block = measureRichMarkdownBlock(part.block.node, {
    fontScale,
    hiddenImageReferences: artifactImageReferences(presentation.artifacts),
    width: contentWidth,
  });
  if (block.status === "dynamic") {
    return dynamicHeight(
      markdownDynamicReason(block.reason),
      estimatedTurnSliceSize({
        contentHeight: estimateDynamicRichMarkdownBlock(part.block.node, {
          fontScale,
          hiddenImageReferences: artifactImageReferences(presentation.artifacts),
          width: contentWidth,
        }),
        fontScale,
        geometry,
        presentation,
        row,
      }),
    );
  }
  const size = exactTimelineRowSize({
    blockHeight: block.height,
    fontScale,
    geometry,
    presentation,
    row,
  });
  return { size, source: "calculated", status: "exact" };
}

function timelineMeasurementDimensions(
  geometry: TimelineRowMeasurementGeometry,
): { readonly contentWidth: number; readonly fontScale: number } | null {
  const fontScale = Math.min(
    APP_MAX_FONT_SIZE_MULTIPLIER,
    Math.max(MINIMUM_FONT_SCALE, geometry.fontScale),
  );
  const contentWidth = timelineMarkdownContentWidth(geometry.viewportWidth);
  return contentWidth === null ? null : { contentWidth, fontScale };
}

/** Returns the exact Markdown content width shared by Pretext and timeline rendering. */
export function timelineMarkdownContentWidth(viewportWidth: number): number | null {
  const timelineItemWidth = Math.min(
    TIMELINE_ITEM_MAX_WIDTH,
    viewportWidth - TIMELINE_HORIZONTAL_CHROME,
  );
  const contentWidth = timelineItemWidth - AGENT_BUBBLE_HORIZONTAL_CHROME;
  return contentWidth > 0 ? contentWidth : null;
}

function timelineRowGeometryKey(
  geometry: TimelineRowMeasurementGeometry,
  dimensions: { readonly contentWidth: number; readonly fontScale: number },
): string {
  return [
    TIMELINE_ROW_GEOMETRY_VERSION,
    dimensions.contentWidth,
    dimensions.fontScale,
    geometry.density,
    Number(geometry.agentDateVisible),
    Number(geometry.beforeDateVisible),
  ].join(":");
}

function dynamicPresentationReason(
  row: MeasurableTimelineRow,
  presentation: ReturnType<typeof projectTurnPresentation>,
): TimelineFixedSizeFallbackReason | null {
  if (isLeadingPlacement(row.placement) && presentation.preTurnBlocks.length > 0) {
    return "leading-activity";
  }
  // WHY: Exact hints are lifetime-fixed sizes in LegendList. Expansion lives inside
  // the row and does not replace its identity, so even collapsed history must allow
  // native layout updates. Keep its premeasured height only as an initial estimate.
  if (rowHasCompletedHistory(row, presentation)) {
    return "expandable-history";
  }
  if (isTrailingPlacement(row.placement) && presentation.artifacts.length > 0) {
    return "trailing-artifacts";
  }
  return null;
}

function exactTimelineRowSize(options: {
  readonly blockHeight: number;
  readonly fontScale: number;
  readonly geometry: TimelineRowMeasurementGeometry;
  readonly presentation: ReturnType<typeof projectTurnPresentation>;
  readonly row: MeasurableTimelineRow;
}): number {
  const { blockHeight, fontScale, geometry, presentation, row } = options;
  const bodyHeight = blockHeight + collapsedCompletedHistoryHeight(row, presentation, fontScale);
  const bubbleHeight = bodyHeight + bubbleVerticalChrome(row);
  const actionRailHeight =
    isLeadingPlacement(row.placement) && presentation.showMessageActions ? controlSize.compact : 0;
  return roundToPhysicalPixel(
    Math.max(bubbleHeight, actionRailHeight) +
      rowOuterVerticalChrome(row, geometry, fontScale) +
      trailingFooterHeight(row, fontScale),
    geometry.density,
  );
}

function estimateDynamicTimelineRow(options: {
  readonly dimensions: { readonly contentWidth: number; readonly fontScale: number };
  readonly geometry: TimelineRowMeasurementGeometry;
  readonly reason: TimelineFixedSizeFallbackReason;
  readonly row: TimelineRow;
}): TimelineRowHeightResult {
  const { dimensions, geometry, reason, row } = options;
  if (row.kind === "turnSlice") {
    const presentation = projectTurnPresentation(row.item, null, false, false);
    let contentHeight = 0;
    let visibleParts = 0;
    for (const part of row.parts) {
      const partHeight = estimateVirtualizedPart(part, presentation, dimensions);
      if (partHeight > 0) {
        contentHeight += partHeight;
        visibleParts += 1;
      }
    }
    contentHeight += Math.max(0, visibleParts - 1) * NON_TRAILING_MARKDOWN_GAP;
    return dynamicHeight(
      reason,
      estimatedTurnSliceSize({
        contentHeight: Math.max(typeScale.label.lineHeight * dimensions.fontScale, contentHeight),
        fontScale: dimensions.fontScale,
        geometry,
        presentation,
        row,
      }),
    );
  }
  if (row.kind === "turnLead") {
    const presentation = projectTurnPresentation(row.item, null, false, false);
    let height = 0;
    for (const block of presentation.userBlocks) {
      height += estimateTextBlock(
        block.body ?? block.title,
        dimensions.contentWidth,
        dimensions.fontScale,
      );
      height += spacing.md * HORIZONTAL_SIDES + typeScale.caption.lineHeight * dimensions.fontScale;
    }
    height +=
      presentation.compactionBlocks.length * (controlSize.compact + spacing.xxs) +
      Math.max(0, presentation.userBlocks.length - 1) * spacing.optical;
    return dynamicHeight(
      reason,
      roundToPhysicalPixel(Math.max(height, controlSize.compact), geometry.density),
    );
  }
  return dynamicHeight(reason, estimateStandaloneTimelineItem(row, geometry, dimensions));
}

function estimateVirtualizedPart(
  part: VirtualizedTurnPart,
  presentation: ReturnType<typeof projectTurnPresentation>,
  dimensions: { readonly contentWidth: number; readonly fontScale: number },
): number {
  if (part.kind === "markdownBlock") {
    const blockGeometry = {
      fontScale: dimensions.fontScale,
      hiddenImageReferences: artifactImageReferences(presentation.artifacts),
      width: dimensions.contentWidth,
    };
    const measured = measureRichMarkdownBlock(part.block.node, blockGeometry);
    return measured.status === "exact"
      ? measured.height
      : estimateDynamicRichMarkdownBlock(part.block.node, blockGeometry);
  }
  if (part.kind === "activity") {
    return controlSize.compact + spacing.optical * HORIZONTAL_SIDES;
  }
  if (part.kind === "externalMarkdown") {
    const source = part.response.body ?? part.response.title;
    return estimateTextBlock(source, dimensions.contentWidth, dimensions.fontScale);
  }
  return typeScale.label.lineHeight * dimensions.fontScale;
}

function estimatedTurnSliceSize(options: {
  readonly contentHeight: number;
  readonly fontScale: number;
  readonly geometry: TimelineRowMeasurementGeometry;
  readonly presentation: ReturnType<typeof projectTurnPresentation>;
  readonly row: MeasurableTimelineRow;
}): number {
  const { contentHeight, fontScale, geometry, presentation, row } = options;
  let bodyHeight = contentHeight;
  if (isLeadingPlacement(row.placement)) {
    bodyHeight +=
      presentation.preTurnBlocks.length * (controlSize.compact + spacing.xxs) +
      collapsedCompletedHistoryHeight(row, presentation, fontScale);
  }
  if (isTrailingPlacement(row.placement)) {
    bodyHeight += presentation.artifacts.length * controlSize.regular;
    bodyHeight += presentation.showEmptyResponsePlaceholder
      ? typeScale.label.lineHeight * fontScale
      : 0;
  }
  const bubbleHeight = bodyHeight + bubbleVerticalChrome(row);
  const actionRailHeight =
    isLeadingPlacement(row.placement) && presentation.showMessageActions ? controlSize.compact : 0;
  return roundToPhysicalPixel(
    Math.max(bubbleHeight, actionRailHeight) +
      rowOuterVerticalChrome(row, geometry, fontScale) +
      trailingFooterHeight(row, fontScale),
    geometry.density,
  );
}

function estimateStandaloneTimelineItem(
  row: Extract<TimelineRow, { kind: "item" }>,
  geometry: TimelineRowMeasurementGeometry,
  dimensions: { readonly contentWidth: number; readonly fontScale: number },
): number {
  const item = row.item;
  if (item.kind === "meta") {
    return roundToPhysicalPixel(
      Math.max(iconSize.inline, typeScale.caption.lineHeight * dimensions.fontScale) +
        spacing.optical * HORIZONTAL_SIDES,
      geometry.density,
    );
  }
  if (item.kind === "optimistic") {
    const userContentWidth =
      dimensions.contentWidth * USER_BUBBLE_WIDTH_RATIO - spacing.md * HORIZONTAL_SIDES;
    const attachmentsHeight =
      item.attachments.length === 0 ? 0 : controlSize.regular * HORIZONTAL_SIDES;
    return roundToPhysicalPixel(
      estimateTextBlock(item.text, userContentWidth, dimensions.fontScale) +
        attachmentsHeight +
        spacing.md * HORIZONTAL_SIDES +
        typeScale.caption.lineHeight * dimensions.fontScale,
      geometry.density,
    );
  }
  return TIMELINE_ROW_FALLBACK_ESTIMATE;
}

function estimateTextBlock(text: string, width: number, fontScale: number): number {
  const fontSize = typeScale.body.fontSize * fontScale;
  const charactersPerLine = Math.max(
    1,
    Math.floor(width / Math.max(1, fontSize * ESTIMATED_GLYPH_WIDTH_RATIO)),
  );
  let lines = 0;
  for (const line of text.split("\n")) {
    lines += Math.max(1, Math.ceil(line.length / charactersPerLine));
  }
  return Math.max(1, lines) * typeScale.body.lineHeight * fontScale;
}

function trailingFooterHeight(row: MeasurableTimelineRow, fontScale: number): number {
  if (!isTrailingPlacement(row.placement)) {
    return 0;
  }
  return (
    Math.max(
      typeScale.label.lineHeight,
      typeScale.caption.lineHeight * fontScale + FOOTER_VERTICAL_PADDING,
    ) +
    FOOTER_GAP +
    FOOTER_MARGIN_BOTTOM
  );
}

function timelineRowIsStreaming(row: MeasurableTimelineRow): boolean {
  return row.item.turn.status === "inProgress" || row.parts.some(isStreamingPart);
}

function singleMarkdownPart(
  parts: readonly VirtualizedTurnPart[],
): Extract<VirtualizedTurnPart, { kind: "markdownBlock" }> | null {
  if (parts.length !== 1 || parts[0]?.kind !== "markdownBlock") {
    return null;
  }
  return parts[0];
}

function collapsedCompletedHistoryHeight(
  row: Extract<TimelineRow, { kind: "turnSlice" }>,
  presentation: ReturnType<typeof projectTurnPresentation>,
  fontScale: number,
): number {
  if (!rowHasCompletedHistory(row, presentation)) {
    return 0;
  }
  return Math.max(
    typeScale.body.lineHeight,
    typeScale.label.lineHeight * fontScale,
    iconSize.inline * fontScale,
  );
}

function rowHasCompletedHistory(
  row: MeasurableTimelineRow,
  presentation: ReturnType<typeof projectTurnPresentation>,
): boolean {
  return (
    isLeadingPlacement(row.placement) &&
    hasCompletedTurnHistory(
      presentation.rawTurn,
      selectTurnRenderWindow(presentation.rawTurn).collapsedActivityIndexes,
    )
  );
}

function bubbleVerticalChrome(row: MeasurableTimelineRow): number {
  const leading = isLeadingPlacement(row.placement);
  const trailing = isTrailingPlacement(row.placement);
  const bubblePadding = (leading ? spacing.md : 0) + (trailing ? spacing.md : 0);
  const markdownGap = trailing ? 0 : NON_TRAILING_MARKDOWN_GAP;
  return bubblePadding + markdownGap;
}

function rowOuterVerticalChrome(
  row: Extract<TimelineRow, { kind: "turnSlice" }>,
  geometry: TimelineRowMeasurementGeometry,
  fontScale: number,
): number {
  const leading = isLeadingPlacement(row.placement);
  const dateSeparatorHeight =
    typeScale.caption.lineHeight * fontScale + DATE_SEPARATOR_VERTICAL_PADDING;
  const beforeDate = geometry.beforeDateVisible ? dateSeparatorHeight : 0;
  const agentDate = leading && geometry.agentDateVisible ? dateSeparatorHeight : 0;
  const agentDateGap = agentDate > 0 && !row.followsLead ? DATE_SEPARATOR_SIBLING_GAP : 0;
  const followsLeadGap = leading && row.followsLead ? FOLLOWING_LEAD_TOP_GAP : 0;
  return beforeDate + agentDate + agentDateGap + followsLeadGap;
}

function isStreamingPart(part: VirtualizedTurnPart): boolean {
  return part.kind === "markdownBlock" && part.streaming;
}

function isLeadingPlacement(placement: VirtualizedTurnPlacement): boolean {
  return placement === "single" || placement === "start";
}

function isTrailingPlacement(placement: VirtualizedTurnPlacement): boolean {
  return placement === "end" || placement === "single";
}

function markdownDynamicReason(
  reason: RichMarkdownDynamicHeightReason,
): TimelineFixedSizeFallbackReason {
  return MARKDOWN_DYNAMIC_REASON[reason];
}

function validGeometry(geometry: TimelineRowMeasurementGeometry): boolean {
  return (
    Number.isFinite(geometry.viewportWidth) &&
    geometry.viewportWidth > 0 &&
    Number.isFinite(geometry.fontScale) &&
    Number.isFinite(geometry.density) &&
    geometry.density > 0
  );
}

function roundToPhysicalPixel(value: number, density: number): number {
  return Math.round(value * density) / density;
}

function cachedTimelineRowSize(row: TimelineRow, key: string): TimelineRowHeightResult | undefined {
  const sizes = timelineRowSizeCache.get(row);
  const size = sizes?.get(key);
  if (size !== undefined) {
    sizes?.delete(key);
    sizes?.set(key, size);
  }
  return size;
}

function rememberTimelineRowSize(
  row: TimelineRow,
  key: string,
  size: TimelineRowHeightResult,
): void {
  const sizes = timelineRowSizeCache.get(row) ?? new Map<string, TimelineRowHeightResult>();
  sizes.delete(key);
  sizes.set(key, size);
  timelineRowSizeCache.set(row, sizes);
  while (sizes.size > TIMELINE_ROW_GEOMETRY_CACHE_LIMIT) {
    const oldest = sizes.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    sizes.delete(oldest);
  }
}

function dynamicHeight(
  reason: TimelineFixedSizeFallbackReason,
  estimate: number,
): TimelineRowHeightResult {
  return {
    estimate: Number.isFinite(estimate) && estimate > 0 ? estimate : TIMELINE_ROW_FALLBACK_ESTIMATE,
    reason,
    status: "dynamic",
  };
}

function dynamicCandidate(reason: TimelineFixedSizeFallbackReason): TimelineRowCandidate {
  return { reason, status: "dynamic" };
}
