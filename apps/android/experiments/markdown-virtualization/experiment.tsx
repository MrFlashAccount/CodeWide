import type { PhrasingContent, RootContent } from "mdast";
import { plainRichMarkdownRootText } from "@codewide/rendering-core";
import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import React, { Profiler, type ReactNode, useEffect, useRef, useState } from "react";
import { createRoot, flushSync } from "react-dom/profiling";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  markdownDocumentBlocks,
  type MarkdownDocumentBlock,
} from "../../src/rendering/markdown-document-blocks";
import { createMarkdownVirtualizationCorpus } from "./corpus";
import { BUBBLE_WIDTH, premeasureMarkdownBlock } from "./premeasure";

type ExperimentMode = "baseline" | "virtualized" | "virtualized-premeasured";

type ExperimentMetrics = {
  readonly commitSyncMs: number;
  readonly contentChars: number;
  readonly domNodes: number;
  readonly initialContentPaintMs: number;
  readonly legendLoadMs: number;
  readonly mode: ExperimentMode;
  readonly mountedBlocks: number;
  readonly peakMountedBlocks: number;
  readonly profilerActualMs: number;
  readonly profilerCommits: number;
  readonly parseMs: number;
  readonly premeasureMs: number;
  readonly renderCalls: number;
  readonly sizeChangeCount: number;
  readonly totalBlocks: number;
  readonly totalReadyMs: number;
  readonly visibleEnd: number;
  readonly visibleStart: number;
};

type ScrollRenderMetrics = {
  readonly destination: "end" | "one-viewport-up" | "start";
  readonly fromVisibleEnd: number;
  readonly fromVisibleStart: number;
  readonly maxFrameIntervalMs: number;
  readonly missedFrameEstimate: number;
  readonly paintMs: number;
  readonly profilerActualMs: number;
  readonly profilerCommits: number;
  readonly renderCalls: number;
  readonly toVisibleEnd: number;
  readonly toVisibleStart: number;
};

type ExperimentApi = {
  readonly closeTools: () => Promise<ExperimentMetrics>;
  readonly openTools: () => Promise<ExperimentMetrics>;
  readonly scrollOneViewportUp: () => Promise<ScrollRenderMetrics>;
  readonly scrollToEnd: () => Promise<ScrollRenderMetrics>;
  readonly scrollToStart: () => Promise<ScrollRenderMetrics>;
  readonly snapshot: () => ExperimentMetrics;
};

declare global {
  interface Window {
    __MARKDOWN_EXPERIMENT_MODE__?: ExperimentMode;
    __MARKDOWN_EXPERIMENT_START__?: number;
    markdownVirtualizationExperiment?: ExperimentApi;
  }
}

const parseStart = performance.now();
const source = createMarkdownVirtualizationCorpus();
const blocks = markdownDocumentBlocks([source]);
const parseMs = performance.now() - parseStart;
const mode: ExperimentMode =
  window.__MARKDOWN_EXPERIMENT_MODE__ === "baseline"
    ? "baseline"
    : window.__MARKDOWN_EXPERIMENT_MODE__ === "virtualized-premeasured"
      ? "virtualized-premeasured"
      : "virtualized";
const premeasureStart = performance.now();
const premeasuredBlocks =
  mode === "virtualized-premeasured"
    ? blocks.map((block, index) => ({
        block,
        fixedHeight: premeasureMarkdownBlock(block, index, blocks.length),
      }))
    : [];
const premeasureMs = performance.now() - premeasureStart;
const experimentStart = window.__MARKDOWN_EXPERIMENT_START__ ?? performance.now();

let legendLoadMs = -1;
let commitSyncMs = -1;
let initialContentPaintMs = -1;
let mountedBlocks = 0;
let peakMountedBlocks = 0;
let profilerActualMs = 0;
let profilerCommits = 0;
let renderCalls = 0;
let listRef: LegendListRef | null = null;
let routeStart = -1;
let sizeChangeCount = 0;

const baselineRows = [{ blocks, key: "large-agent-turn" }];
const tools = Array.from({ length: 180 }, (_, index) => ({
  detail: `Command output ${String(index + 1)} is retained outside the conversation viewport.`,
  id: `tool-${String(index + 1)}`,
  title: index % 3 === 0 ? "Read file" : index % 3 === 1 ? "Run command" : "Apply patch",
}));

function nextFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function currentMetrics(): ExperimentMetrics {
  const state = listRef?.getState();
  return {
    commitSyncMs,
    contentChars: source.length,
    domNodes: document.getElementsByTagName("*").length,
    initialContentPaintMs,
    legendLoadMs,
    mode,
    mountedBlocks,
    peakMountedBlocks,
    parseMs,
    premeasureMs,
    profilerActualMs,
    profilerCommits,
    renderCalls,
    sizeChangeCount,
    totalBlocks: blocks.length,
    totalReadyMs: performance.now() - experimentStart,
    visibleEnd: state?.end ?? -1,
    visibleStart: state?.start ?? -1,
  };
}

async function settle(): Promise<ExperimentMetrics> {
  await nextFrames();
  return currentMetrics();
}

function recordInitialContentPaint(elapsedTimeInMs: number): void {
  legendLoadMs = elapsedTimeInMs;
  if (initialContentPaintMs >= 0) {
    return;
  }
  void waitForVisibleBlocks()
    .then(nextFrames)
    .then(() => {
      initialContentPaintMs = performance.now() - routeStart;
    });
}

function visibleBlocksAreMounted(): boolean {
  if (mode === "baseline") {
    return document.querySelector('[data-testid="baseline-bubble"]') !== null;
  }
  const state = listRef?.getState();
  if (state === undefined || state.start < 0 || state.end < state.start) {
    return false;
  }
  for (let index = state.start; index <= state.end; index += 1) {
    if (document.querySelector(`[data-block-index="${String(index)}"]`) === null) {
      return false;
    }
  }
  return true;
}

async function waitForVisibleBlocks(): Promise<void> {
  for (let frame = 0; frame < 120; frame += 1) {
    if (visibleBlocksAreMounted()) {
      return;
    }
    await nextFrame();
  }
  throw new Error("Legend List visible blocks were not mounted within 120 frames");
}

async function waitForVisibleRangeChangeAndBlocks(
  previousStart: number,
  previousEnd: number,
): Promise<void> {
  for (let frame = 0; frame < 120; frame += 1) {
    const state = listRef?.getState();
    if (
      state !== undefined &&
      (state.start !== previousStart || state.end !== previousEnd) &&
      visibleBlocksAreMounted()
    ) {
      return;
    }
    await nextFrame();
  }
  throw new Error("Legend List visible range did not change within 120 frames");
}

async function measureScrollRender(
  destination: ScrollRenderMetrics["destination"],
  scroll: () => Promise<void>,
): Promise<ScrollRenderMetrics> {
  const previousState = listRef?.getState();
  if (previousState === undefined) {
    throw new Error("Legend List state is unavailable");
  }
  const start = performance.now();
  const initialProfilerActualMs = profilerActualMs;
  const initialProfilerCommits = profilerCommits;
  const initialRenderCalls = renderCalls;
  const frameIntervals: number[] = [];
  let previousFrameAt = start;
  let samplingFrames = true;
  function sampleFrame(frameAt: number): void {
    frameIntervals.push(frameAt - previousFrameAt);
    previousFrameAt = frameAt;
    if (samplingFrames) {
      requestAnimationFrame(sampleFrame);
    }
  }
  requestAnimationFrame(sampleFrame);
  await scroll();
  if (mode !== "baseline") {
    await waitForVisibleRangeChangeAndBlocks(previousState.start, previousState.end);
  }
  await nextFrames();
  samplingFrames = false;
  const currentState = listRef?.getState();
  if (currentState === undefined) {
    throw new Error("Legend List state became unavailable after scrolling");
  }
  const displayIntervalMs = 1_000 / 60;
  return {
    destination,
    fromVisibleEnd: previousState.end,
    fromVisibleStart: previousState.start,
    maxFrameIntervalMs: Math.max(...frameIntervals),
    missedFrameEstimate: frameIntervals.reduce(
      (total, interval) => total + Math.max(0, Math.round(interval / displayIntervalMs) - 1),
      0,
    ),
    paintMs: performance.now() - start,
    profilerActualMs: profilerActualMs - initialProfilerActualMs,
    profilerCommits: profilerCommits - initialProfilerCommits,
    renderCalls: renderCalls - initialRenderCalls,
    toVisibleEnd: currentState.end,
    toVisibleStart: currentState.start,
  };
}

function TrackedBlock({ block }: { readonly block: MarkdownDocumentBlock }) {
  renderCalls += 1;
  useEffect(() => {
    mountedBlocks += 1;
    peakMountedBlocks = Math.max(peakMountedBlocks, mountedBlocks);
    return () => {
      mountedBlocks -= 1;
    };
  }, []);
  return <MarkdownBlock node={block.node} />;
}

function MarkdownBlock({ node }: { readonly node: RootContent }) {
  switch (node.type) {
    case "heading":
      return <Text style={styles.heading}>{inline(node.children)}</Text>;
    case "paragraph":
      return <Text style={styles.paragraph}>{inline(node.children)}</Text>;
    case "blockquote":
      return (
        <View style={styles.quote}>
          {node.children.map((child, index) => (
            <MarkdownBlock key={`${child.type}-${String(index)}`} node={child} />
          ))}
        </View>
      );
    case "list":
      return (
        <View style={styles.list}>
          {node.children.map((item, index) => (
            <View key={`item-${String(index)}`} style={styles.listRow}>
              <Text style={styles.marker}>
                {node.ordered ? `${String((node.start ?? 1) + index)}.` : "•"}
              </Text>
              <View style={styles.listBody}>
                {item.children.map((child, childIndex) => (
                  <MarkdownBlock key={`${child.type}-${String(childIndex)}`} node={child} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case "code":
      return (
        <View style={styles.code}>
          <Text style={styles.codeLanguage}>{node.lang ?? "text"}</Text>
          <Text style={styles.codeText}>{node.value}</Text>
        </View>
      );
    case "table":
      return (
        <View style={styles.table}>
          {node.children.map((row, rowIndex) => (
            <View key={`row-${String(rowIndex)}`} style={styles.tableRow}>
              {row.children.map((cell, cellIndex) => (
                <Text key={`cell-${String(cellIndex)}`} style={styles.tableCell}>
                  {plainRichMarkdownRootText(cell)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
    case "thematicBreak":
      return <View style={styles.rule} />;
    case "html":
    case "yaml":
      return <Text style={styles.paragraph}>{node.value}</Text>;
    default:
      return <Text style={styles.paragraph}>{plainRichMarkdownRootText(node)}</Text>;
  }
}

function inline(nodes: readonly PhrasingContent[]): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${node.type}-${String(index)}`;
    switch (node.type) {
      case "text":
        return node.value;
      case "inlineCode":
        return (
          <Text key={key} style={styles.inlineCode}>
            {node.value}
          </Text>
        );
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {inline(node.children)}
          </Text>
        );
      case "emphasis":
        return (
          <Text key={key} style={styles.emphasis}>
            {inline(node.children)}
          </Text>
        );
      case "delete":
        return (
          <Text key={key} style={styles.deleted}>
            {inline(node.children)}
          </Text>
        );
      case "link":
      case "linkReference":
        return (
          <Text key={key} style={styles.link}>
            {inline(node.children)}
          </Text>
        );
      case "break":
        return "\n";
      case "image":
      case "imageReference":
        return node.alt ?? "Image";
      case "footnoteReference":
        return `[${node.identifier}]`;
      case "html":
        return node.value;
      default:
        return plainRichMarkdownRootText(node);
    }
  });
}

function BubbleSegment({
  block,
  fixedHeight,
  index,
  showActions = false,
}: {
  readonly block: MarkdownDocumentBlock;
  readonly fixedHeight?: number;
  readonly index: number;
  readonly showActions?: boolean;
}) {
  const first = index === 0;
  const last = index === blocks.length - 1;
  const surface = (
    <View
      dataSet={{
        blockIndex: String(index),
        fixedHeight: fixedHeight === undefined ? "" : String(fixedHeight),
      }}
      style={[
        styles.segment,
        first ? styles.segmentFirst : null,
        last ? styles.segmentLast : null,
        fixedHeight === undefined ? null : { height: fixedHeight },
      ]}
      testID={`markdown-block-${String(index)}`}
    >
      <View testID={`markdown-block-content-${String(index)}`}>
        <TrackedBlock block={block} />
      </View>
    </View>
  );
  if (!last || !showActions) {
    return surface;
  }
  return (
    <View style={styles.segmentedTurn}>
      {surface}
      <ActionRail />
    </View>
  );
}

function BaselineTurn() {
  return (
    <View style={styles.baselineTurn}>
      <View style={styles.baselineBubble} testID="baseline-bubble">
        {blocks.map((block) => (
          <TrackedBlock block={block} key={block.key} />
        ))}
      </View>
      <ActionRail />
    </View>
  );
}

function ActionRail() {
  return (
    <View style={styles.actionRail} testID="action-rail">
      <Text style={styles.actionText}>Copy</Text>
      <Text style={styles.actionText}>Review</Text>
      <Text style={styles.actionText}>Tools</Text>
    </View>
  );
}

function ToolSheet({ onClose }: { readonly onClose: () => void }) {
  return (
    <View style={styles.sheetBackdrop} testID="tools-sheet">
      <Pressable onPress={onClose} style={styles.sheetDismiss} />
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetEyebrow}>ACTIVITY</Text>
            <Text style={styles.sheetTitle}>180 historical tool calls</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </Pressable>
        </View>
        <LegendList
          data={tools}
          drawDistance={200}
          estimatedItemSize={72}
          getItemType={() => "tool"}
          keyExtractor={(item) => item.id}
          recycleItems
          renderItem={({ item }) => (
            <View style={styles.toolRow} testID={`tool-row-${item.id}`}>
              <View style={styles.toolDot} />
              <View style={styles.toolBody}>
                <Text style={styles.toolTitle}>{item.title}</Text>
                <Text numberOfLines={1} style={styles.toolDetail}>
                  {item.detail}
                </Text>
              </View>
            </View>
          )}
        />
      </View>
    </View>
  );
}

function Experiment() {
  const ref = useRef<LegendListRef>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    listRef = ref.current;
    return () => {
      listRef = null;
    };
  }, []);

  function onProfilerRender(
    _id: string,
    _phase: "mount" | "update" | "nested-update",
    actualDuration: number,
  ) {
    profilerActualMs += actualDuration;
    profilerCommits += 1;
  }

  async function openTools(): Promise<ExperimentMetrics> {
    setToolsOpen(true);
    return settle();
  }

  async function closeTools(): Promise<ExperimentMetrics> {
    setToolsOpen(false);
    return settle();
  }

  async function scrollOneViewportUp(): Promise<ScrollRenderMetrics> {
    return measureScrollRender("one-viewport-up", async () => {
      const state = ref.current?.getState();
      if (state === undefined) {
        throw new Error("Legend List state is unavailable");
      }
      const scrollElement = document.querySelector('[data-testid="markdown-list"]');
      if (!(scrollElement instanceof HTMLElement)) {
        throw new Error("Legend List scroll element is unavailable");
      }
      scrollElement.scrollTop = Math.max(0, state.scroll - state.scrollLength);
    });
  }

  async function scrollToStart(): Promise<ScrollRenderMetrics> {
    return measureScrollRender("start", async () => {
      await ref.current?.scrollToIndex({ animated: false, index: 0 });
    });
  }

  async function scrollToEnd(): Promise<ScrollRenderMetrics> {
    return measureScrollRender("end", async () => {
      await ref.current?.scrollToEnd({ animated: false });
    });
  }

  window.markdownVirtualizationExperiment = {
    closeTools,
    openTools,
    scrollOneViewportUp,
    scrollToEnd,
    scrollToStart,
    snapshot: currentMetrics,
  };

  return (
    <View style={styles.app}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>LEGEND LIST / WEB HARNESS</Text>
          <Text style={styles.title}>Markdown virtualization</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{mode}</Text>
        </View>
      </View>
      <View style={styles.summary}>
        <Text style={styles.summaryText}>{source.length.toLocaleString()} chars</Text>
        <Text style={styles.summaryDivider}>·</Text>
        <Text style={styles.summaryText}>{blocks.length.toLocaleString()} blocks</Text>
        <Text style={styles.summaryDivider}>·</Text>
        <Pressable onPress={() => setToolsOpen(true)} testID="open-tools">
          <Text style={styles.summaryLink}>180 tools in sheet</Text>
        </Pressable>
      </View>
      <Profiler id="markdown-list" onRender={onProfilerRender}>
        {mode === "baseline" ? (
          <LegendList
            alignItemsAtEnd
            data={baselineRows}
            drawDistance={300}
            estimatedItemSize={4_000}
            initialScrollIndex={0}
            keyExtractor={(item) => item.key}
            onLoad={({ elapsedTimeInMs }) => recordInitialContentPaint(elapsedTimeInMs)}
            onItemSizeChanged={() => {
              sizeChangeCount += 1;
            }}
            recycleItems={false}
            ref={ref}
            renderItem={() => <BaselineTurn />}
            style={styles.listViewport}
            testID="markdown-list"
          />
        ) : mode === "virtualized" ? (
          <LegendList
            alignItemsAtEnd
            data={blocks}
            drawDistance={300}
            estimatedItemSize={96}
            getItemType={(item) => item.node.type}
            initialScrollAtEnd
            keyExtractor={(item) => item.key}
            maintainVisibleContentPosition={{ data: true, size: true }}
            onLoad={({ elapsedTimeInMs }) => recordInitialContentPaint(elapsedTimeInMs)}
            onItemSizeChanged={() => {
              sizeChangeCount += 1;
            }}
            recycleItems={false}
            ref={ref}
            renderItem={({ item, index }) => (
              <BubbleSegment block={item} index={index} showActions />
            )}
            style={styles.listViewport}
            testID="markdown-list"
          />
        ) : (
          <LegendList
            alignItemsAtEnd
            data={premeasuredBlocks}
            drawDistance={300}
            estimatedItemSize={96}
            getFixedItemSize={(item) => item.fixedHeight}
            getItemType={(item) => item.block.node.type}
            initialScrollAtEnd
            keyExtractor={(item) => item.block.key}
            ListFooterComponent={<ActionRail />}
            maintainVisibleContentPosition={{ data: true, size: true }}
            onLoad={({ elapsedTimeInMs }) => recordInitialContentPaint(elapsedTimeInMs)}
            onItemSizeChanged={() => {
              sizeChangeCount += 1;
            }}
            recycleItems={false}
            ref={ref}
            renderItem={({ item, index }) => (
              <BubbleSegment block={item.block} fixedHeight={item.fixedHeight} index={index} />
            )}
            style={styles.listViewport}
            testID="markdown-list"
          />
        )}
      </Profiler>
      {toolsOpen ? <ToolSheet onClose={() => setToolsOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  actionRail: {
    alignSelf: "center",
    flexDirection: "row",
    gap: 18,
    paddingBottom: 28,
    paddingTop: 14,
    width: 620,
  },
  actionText: { color: "#9ca6b8", fontSize: 13, fontWeight: "600" },
  app: { backgroundColor: "#0b0d11", flex: 1, height: "100vh", overflow: "hidden", width: "100vw" },
  badge: {
    backgroundColor: "#24314a",
    borderColor: "#435a86",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { color: "#c6d8ff", fontSize: 12, fontWeight: "700", textTransform: "uppercase" },
  baselineBubble: {
    backgroundColor: "#171b22",
    borderRadius: 18,
    paddingBottom: 18,
    paddingHorizontal: 22,
    paddingTop: 18,
    width: BUBBLE_WIDTH,
  },
  baselineTurn: { alignSelf: "center", marginTop: 16, width: BUBBLE_WIDTH },
  closeButton: {
    backgroundColor: "#252b36",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  closeText: { color: "#e7eaf0", fontSize: 13, fontWeight: "600" },
  code: {
    backgroundColor: "#0e1117",
    borderColor: "#303746",
    borderRadius: 10,
    borderWidth: 1,
    marginVertical: 8,
    overflow: "hidden",
  },
  codeLanguage: {
    backgroundColor: "#1d222c",
    color: "#8792a6",
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    textTransform: "uppercase",
  },
  codeText: {
    color: "#d7dce6",
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
    padding: 12,
  },
  deleted: { textDecorationLine: "line-through" },
  emphasis: { fontStyle: "italic" },
  eyebrow: { color: "#687388", fontSize: 10, fontWeight: "700", letterSpacing: 1.4 },
  header: {
    alignItems: "center",
    borderBottomColor: "#242a35",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 26,
    paddingVertical: 16,
  },
  heading: {
    color: "#f1f3f7",
    fontSize: 19,
    fontWeight: "700",
    lineHeight: 26,
    marginBottom: 8,
    marginTop: 14,
  },
  inlineCode: {
    backgroundColor: "#292f3a",
    color: "#f0c674",
    fontFamily: "monospace",
    fontSize: 13,
  },
  link: { color: "#8ab4ff", textDecorationLine: "underline" },
  list: { marginBottom: 8, marginTop: 2 },
  listBody: { flex: 1 },
  listRow: { alignItems: "flex-start", flexDirection: "row", gap: 8 },
  listViewport: { flex: 1, minHeight: 0 },
  marker: { color: "#8f9aad", fontSize: 14, lineHeight: 22, width: 20 },
  paragraph: { color: "#d7dbe4", fontSize: 15, lineHeight: 23, marginBottom: 8 },
  quote: { borderLeftColor: "#6578a4", borderLeftWidth: 3, marginBottom: 8, paddingLeft: 13 },
  rule: { backgroundColor: "#343b48", height: 1, marginVertical: 12 },
  segment: {
    alignSelf: "center",
    backgroundColor: "#171b22",
    paddingHorizontal: 22,
    width: BUBBLE_WIDTH,
  },
  segmentFirst: { borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingTop: 18 },
  segmentLast: { borderBottomLeftRadius: 18, borderBottomRightRadius: 18, paddingBottom: 18 },
  segmentedTurn: { alignSelf: "center", width: BUBBLE_WIDTH },
  sheet: {
    backgroundColor: "#141820",
    borderLeftColor: "#303746",
    borderLeftWidth: 1,
    bottom: 0,
    position: "absolute",
    right: 0,
    top: 0,
    width: 460,
  },
  sheetBackdrop: {
    backgroundColor: "rgba(2, 4, 8, 0.64)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  sheetDismiss: { bottom: 0, left: 0, position: "absolute", right: 460, top: 0 },
  sheetEyebrow: { color: "#7d8aa2", fontSize: 10, fontWeight: "700", letterSpacing: 1.2 },
  sheetHeader: {
    alignItems: "center",
    borderBottomColor: "#2d3441",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 20,
  },
  sheetTitle: { color: "#f2f4f8", fontSize: 19, fontWeight: "700", marginTop: 4 },
  strong: { fontWeight: "700" },
  summary: {
    alignItems: "center",
    backgroundColor: "#10131a",
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 26,
    paddingVertical: 10,
  },
  summaryDivider: { color: "#465064", fontSize: 13 },
  summaryLink: { color: "#8ab4ff", fontSize: 13, fontWeight: "600" },
  summaryText: { color: "#919bad", fontSize: 13 },
  table: {
    borderColor: "#343c4a",
    borderLeftWidth: 1,
    borderTopWidth: 1,
    marginBottom: 10,
    marginTop: 4,
  },
  tableCell: {
    borderBottomColor: "#343c4a",
    borderBottomWidth: 1,
    borderRightColor: "#343c4a",
    borderRightWidth: 1,
    color: "#cdd3de",
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    padding: 7,
  },
  tableRow: { flexDirection: "row" },
  title: { color: "#f2f4f8", fontSize: 20, fontWeight: "700", marginTop: 3 },
  toolBody: { flex: 1 },
  toolDetail: { color: "#7f899c", fontSize: 12, marginTop: 3 },
  toolDot: { backgroundColor: "#67d391", borderRadius: 4, height: 8, marginTop: 5, width: 8 },
  toolRow: {
    alignItems: "flex-start",
    borderBottomColor: "#252c37",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 12,
    minHeight: 72,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  toolTitle: { color: "#e4e8ef", fontSize: 14, fontWeight: "600" },
});

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Markdown virtualization experiment requires #root");
}

const reactRoot = createRoot(root);
routeStart = performance.now();
const commitStart = performance.now();
flushSync(() => reactRoot.render(<Experiment />));
commitSyncMs = performance.now() - commitStart;
