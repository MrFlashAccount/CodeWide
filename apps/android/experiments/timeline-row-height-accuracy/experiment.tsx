import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import type { Nodes } from "mdast";
import React, { useLayoutEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { StyleSheet, View } from "react-native";

import { PerformanceExperimentProvider } from "../../src/data/performance-experiments";
import {
  projectTimelineRows,
  type TimelineRow,
} from "../../src/features/conversation/timeline/timelineRows";
import {
  timelineRowHeight,
  type TimelineRowHeightResult,
} from "../../src/features/conversation/timeline/timelineRowPremeasurement";
import type { TimelineItem } from "../../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../../src/features/conversation/turns/turnProjection";
import { VirtualizedTurnTimelineItem } from "../../src/features/conversation/turns/VirtualizedTurnTimelineItem";
import { AppDialogProvider } from "../../src/ui/AppDialog";
import { MessageActionMenuProvider } from "../../src/ui/MessageActionMenu";
import {
  RichMarkdownPremeasurementBoundary,
  RichMarkdownPremeasurementProvider,
} from "../../src/rendering/RichMarkdownPremeasurementProvider";
import { createMarkdownVirtualizationCorpus } from "../markdown-virtualization/corpus";

type ExperimentMode = "measured" | "natural" | "premeasured" | "pretext-natural";
type TurnRow = Extract<TimelineItem, { kind: "turn" }>;

type RowMeasurement = {
  readonly allocatedHeight: number;
  readonly bubbleContentWidth: number;
  readonly calculated: TimelineRowHeightResult;
  readonly contentHeight: number;
  readonly index: number;
  readonly key: string;
  readonly nodeType: string;
  readonly placement: string;
  readonly textShape: "non-text" | "plain" | "rich";
  readonly textFeatures: string;
};

type ExperimentResult = {
  readonly mode: ExperimentMode;
  readonly rows: readonly RowMeasurement[];
};

type ExperimentApi = {
  readonly ready: () => boolean;
  readonly scan: () => Promise<ExperimentResult>;
};

declare global {
  interface Window {
    __TIMELINE_HEIGHT_GEOMETRY__?: {
      readonly density: number;
      readonly fontScale: number;
      readonly viewportWidth: number;
    };
    __TIMELINE_HEIGHT_INCLUDE_ACTIVITY__?: boolean;
    __TIMELINE_HEIGHT_MODE__?: ExperimentMode;
    __TIMELINE_HEIGHT_SOURCES__?: readonly string[];
    timelineHeightAccuracyExperiment?: ExperimentApi;
  }
}

const geometry = window.__TIMELINE_HEIGHT_GEOMETRY__ ?? {
  density: 1,
  fontScale: 1,
  viewportWidth: 412,
};
const sources = window.__TIMELINE_HEIGHT_SOURCES__ ?? [
  createMarkdownVirtualizationCorpus().slice(0, 20_000),
];
const turns = sources.map((source, index) =>
  completedTurn(source, index, window.__TIMELINE_HEIGHT_INCLUDE_ACTIVITY__ === true && index === 0),
);
const rows = turns
  .flatMap((turn) =>
    projectTimelineRows([turn], {
      enabled: true,
      searchMessageItemId: null,
      threadSearchActive: false,
    }),
  )
  .filter((row): row is Extract<TimelineRow, { kind: "turnSlice" }> => row.kind === "turnSlice");
const presentations = new Map(
  turns.map((turn) => [turn.key, projectTurnPresentation(turn, null, false, false)]),
);
const calculatedRows = new Map(
  rows.map((row) => [
    row.key,
    timelineRowHeight(row, {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: geometry.density,
      fontScale: geometry.fontScale,
      viewportWidth: geometry.viewportWidth,
    }),
  ]),
);
const mode: ExperimentMode =
  window.__TIMELINE_HEIGHT_MODE__ === "premeasured"
    ? "premeasured"
    : window.__TIMELINE_HEIGHT_MODE__ === "pretext-natural"
      ? "pretext-natural"
      : window.__TIMELINE_HEIGHT_MODE__ === "natural"
        ? "natural"
        : "measured";

function rendersWithoutList(selectedMode: ExperimentMode): boolean {
  return selectedMode === "natural" || selectedMode === "pretext-natural";
}

function completedTurn(markdown: string, index: number, includeActivity: boolean): TurnRow {
  const id = `long-answer-${String(index)}`;
  const value: unknown = {
    connectionId: "height-accuracy",
    id,
    key: `height-accuracy/thread/${id}`,
    kind: "turn",
    scope: "height-accuracy/thread",
    threadId: "thread",
    turn: {
      completedAt: 2,
      durationMs: 1,
      error: null,
      id,
      items: [
        {
          clientId: null,
          content: [{ text: "Render the response", text_elements: [], type: "text" }],
          id: `${id}-user`,
          type: "userMessage",
        },
        ...(includeActivity
          ? [
              {
                aggregatedOutput: "done",
                command: "printf done",
                commandActions: [],
                cwd: "/workspace",
                durationMs: 10,
                exitCode: 0,
                id: `${id}-command`,
                processId: null,
                source: "agent",
                status: "completed",
                type: "commandExecution",
              },
            ]
          : []),
        {
          id: `${id}-agent`,
          phase: "final_answer",
          text: markdown,
          type: "agentMessage",
        },
      ],
      itemsView: "full",
      startedAt: 1,
      status: "completed",
    },
  };
  // WHY: The generated protocol union has no narrow fixture factory for a completed agent turn.
  // The experiment supplies only the validated fields consumed by the production projection.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return value as TurnRow;
}

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

async function waitForRow(index: number): Promise<HTMLElement> {
  for (let frame = 0; frame < 120; frame += 1) {
    const element = document.querySelector<HTMLElement>(`[data-height-row="${String(index)}"]`);
    if (element !== null) {
      await nextFrame();
      await nextFrame();
      return element;
    }
    await nextFrame();
  }
  throw new Error(`Timeline row ${String(index)} did not mount within 120 frames`);
}

function rowNodeType(row: Extract<TimelineRow, { kind: "turnSlice" }>): string {
  const part = row.parts[0];
  return part?.kind === "markdownBlock" ? part.block.node.type : (part?.kind ?? "empty");
}

function rowTextShape(
  row: Extract<TimelineRow, { kind: "turnSlice" }>,
): RowMeasurement["textShape"] {
  const part = row.parts[0];
  if (part?.kind !== "markdownBlock") {
    return "non-text";
  }
  const node = part.block.node;
  if (!["blockquote", "heading", "list", "paragraph"].includes(node.type)) {
    return "non-text";
  }
  return markdownNodeHasRichInline(node) ? "rich" : "plain";
}

function markdownNodeHasRichInline(node: Nodes): boolean {
  if (
    node.type === "break" ||
    node.type === "text" ||
    node.type === "definition" ||
    node.type === "thematicBreak" ||
    node.type === "yaml"
  ) {
    return false;
  }
  if (
    node.type === "delete" ||
    node.type === "emphasis" ||
    node.type === "footnoteReference" ||
    node.type === "html" ||
    node.type === "image" ||
    node.type === "imageReference" ||
    node.type === "inlineCode" ||
    node.type === "link" ||
    node.type === "linkReference" ||
    node.type === "strong"
  ) {
    return true;
  }
  if ("children" in node) {
    return node.children.some(markdownNodeHasRichInline);
  }
  return false;
}

function rowTextFeatures(row: Extract<TimelineRow, { kind: "turnSlice" }>): string {
  const part = row.parts[0];
  if (part?.kind !== "markdownBlock") {
    return "";
  }
  const features = new Set<string>();
  collectTextFeatures(part.block.node, features);
  return [...features].sort().join(",");
}

function collectTextFeatures(node: Nodes, features: Set<string>): void {
  if (
    node.type !== "blockquote" &&
    node.type !== "heading" &&
    node.type !== "list" &&
    node.type !== "listItem" &&
    node.type !== "paragraph" &&
    node.type !== "text"
  ) {
    features.add(node.type);
  }
  if ("children" in node) {
    for (const child of node.children) {
      collectTextFeatures(child, features);
    }
  }
}

function TimelineRowView({
  index,
  row,
}: {
  readonly index: number;
  readonly row: Extract<TimelineRow, { kind: "turnSlice" }>;
}) {
  const presentation = presentations.get(row.item.key);
  if (presentation === undefined) {
    throw new Error(`Timeline row ${row.key} has no turn presentation`);
  }
  return (
    <View dataSet={{ heightRow: String(index) }} style={styles.timelineRow}>
      <View style={styles.timelineItem}>
        <VirtualizedTurnTimelineItem
          animateLiveUpdates={false}
          compact={false}
          followsLead={row.followsLead}
          forceExpanded={false}
          parts={row.parts}
          placement={row.placement}
          presentation={presentation}
          requestPrompt={null}
          turn={row.item}
        />
      </View>
    </View>
  );
}

function Experiment() {
  const listRef = useRef<LegendListRef>(null);
  useLayoutEffect(() => {
    window.timelineHeightAccuracyExperiment = {
      ready: () => {
        if (rendersWithoutList(mode)) {
          return document.querySelectorAll("[data-height-row]").length === rows.length;
        }
        const state = listRef.current?.getState();
        return state !== undefined && state.start >= 0 && state.end >= state.start;
      },
      scan: async () => {
        const measurements: RowMeasurement[] = [];
        if (rendersWithoutList(mode)) {
          await nextFrame();
          await nextFrame();
        }
        for (let index = 0; index < rows.length; index += 1) {
          if (!rendersWithoutList(mode)) {
            await listRef.current?.scrollToIndex({ animated: false, index, viewPosition: 0 });
          }
          const element = rendersWithoutList(mode)
            ? document.querySelector<HTMLElement>(`[data-height-row="${String(index)}"]`)
            : await waitForRow(index);
          if (element === null) {
            throw new Error(`Timeline row ${String(index)} is not mounted`);
          }
          const row = rows[index];
          if (row === undefined) {
            throw new Error(`Timeline row ${String(index)} disappeared`);
          }
          const calculated = calculatedRows.get(row.key);
          if (calculated === undefined) {
            throw new Error(`Timeline row ${row.key} has no calculated height`);
          }
          const bubble = element.querySelector<HTMLElement>('[data-testid="codex-bubble"]');
          const bubbleStyle = bubble === null ? null : window.getComputedStyle(bubble);
          measurements.push({
            allocatedHeight: rendersWithoutList(mode)
              ? element.getBoundingClientRect().height
              : (listRef.current?.getState().sizeAtIndex(index) ?? -1),
            bubbleContentWidth:
              bubble === null || bubbleStyle === null
                ? -1
                : bubble.getBoundingClientRect().width -
                  Number.parseFloat(bubbleStyle.paddingLeft) -
                  Number.parseFloat(bubbleStyle.paddingRight),
            calculated,
            contentHeight: element.getBoundingClientRect().height,
            index,
            key: row.key,
            nodeType: rowNodeType(row),
            placement: row.placement,
            textFeatures: rowTextFeatures(row),
            textShape: rowTextShape(row),
          });
        }
        return { mode, rows: measurements };
      },
    };
    return () => {
      delete window.timelineHeightAccuracyExperiment;
    };
  }, []);

  const getItemSizeHint = (
    row: Extract<TimelineRow, { kind: "turnSlice" }>,
  ): { readonly size: number; readonly status: "estimated" | "exact" } | undefined => {
    if (mode !== "premeasured") {
      return undefined;
    }
    const result = calculatedRows.get(row.key);
    return result?.status === "exact"
      ? { size: result.size, status: "exact" }
      : result === undefined
        ? undefined
        : { size: result.estimate, status: "estimated" };
  };

  return (
    <View style={[styles.screen, rendersWithoutList(mode) ? styles.naturalScreen : null]}>
      {rendersWithoutList(mode) ? (
        <View>
          {rows.map((row, index) => (
            <TimelineRowView index={index} key={row.key} row={row} />
          ))}
        </View>
      ) : (
        <LegendList
          data={rows}
          drawDistance={250}
          estimatedItemSize={115}
          {...(mode === "premeasured" ? { getItemSizeHint } : {})}
          keyExtractor={(row) => row.key}
          recycleItems={false}
          ref={listRef}
          renderItem={({ item, index }) => <TimelineRowView index={index} row={item} />}
          style={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  naturalScreen: { height: "auto" },
  screen: {
    height: 840,
    paddingHorizontal: 16,
    width: geometry.viewportWidth,
  },
  timelineItem: {
    alignSelf: "center",
    maxWidth: 880,
    width: "100%",
  },
  timelineRow: { width: "100%" },
});

const root = document.getElementById("root");
if (root === null) {
  throw new Error("Timeline height experiment root is missing");
}
createRoot(root).render(
  <PerformanceExperimentProvider>
    <AppDialogProvider>
      <MessageActionMenuProvider>
        <RichMarkdownPremeasurementProvider
          enabled={mode === "premeasured" || mode === "pretext-natural"}
          fontScale={geometry.fontScale}
          width={geometry.viewportWidth - 16 * 4 - 32}
        >
          <RichMarkdownPremeasurementBoundary>
            <Experiment />
          </RichMarkdownPremeasurementBoundary>
        </RichMarkdownPremeasurementProvider>
      </MessageActionMenuProvider>
    </AppDialogProvider>
  </PerformanceExperimentProvider>,
);
