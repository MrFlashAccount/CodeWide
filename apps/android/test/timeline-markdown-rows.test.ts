import { describe, expect, it, vi } from "vitest";
import { parseRichMarkdown } from "@codewide/rendering-core";
import type { ProjectedTurnMetadata } from "@codewide/sync-client";

const pretextMock = vi.hoisted(() => ({
  measureInlineFlow: vi.fn((_prepared: unknown, _width: number, lineHeight: number) => ({
    height: lineHeight * 2,
    lineCount: 2,
  })),
  prepareInlineFlow: vi.fn((items: readonly unknown[]) => items),
  validateFont: vi.fn(() => true),
  verifyFontsLoaded: vi.fn(() => ({
    applied: true,
    isSystemFont: false,
    requestedWidth: 10,
    resolvedFamily: "RobotoFlex-Regular",
    systemWidth: 9,
    widthDifference: 1,
  })),
  walkInlineFlowLines: vi.fn(
    (
      prepared: readonly { readonly text?: string }[],
      _width: number,
      onLine: (line: { readonly fragments: readonly unknown[] }) => void,
    ) => {
      const fragments = prepared.map((item, itemIndex) => ({
        gapBefore: 0,
        itemIndex,
        text: item.text ?? "",
      }));
      onLine({ fragments });
      onLine({ fragments: [] });
      return 2;
    },
  ),
}));

vi.mock("expo-pretext", () => pretextMock);

import {
  projectTimelineRows,
  timelineRowKey,
  timelineRowSizeEstimate,
  timelineResponseStartRow,
} from "../src/features/conversation/timeline/timelineRows";
import { timelineRowHeight } from "../src/features/conversation/timeline/timelineRowPremeasurement";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import {
  estimateDynamicRichMarkdownBlock,
  layoutRichMarkdownInline,
  measureRichMarkdownBlock,
} from "../src/rendering/richMarkdownGeometry";

type TurnRow = Extract<TimelineItem, { kind: "turn" }>;

const LARGE_MARKDOWN = Array.from(
  { length: 56 },
  (_, index) => `## Section ${String(index)}

This is a deliberately long paragraph for the virtualized conversation Markdown experiment. It contains enough words to wrap across several lines while preserving the ordinary rich Markdown presentation.

| Signal | Value |
| --- | --- |
| section | ${String(index)} |

\`\`\`ts
const section${String(index)} = "stable";
\`\`\`
`,
).join("\n");

function turnRow(id: string, source: string, status: "completed" | "inProgress" = "completed") {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: status === "completed" ? 2 : null,
      durationMs: status === "completed" ? 1 : null,
      id,
      items: [{ id: `${id}-agent`, phase: "final_answer", text: source, type: "agentMessage" }],
      startedAt: 1,
      status,
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnRow;
}

function streamingTurnRow(id: string, items: readonly unknown[]): TurnRow {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      id,
      items,
      startedAt: 1,
      status: "inProgress",
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnRow;
}

function completedConversationTurnRow(id: string, source: string): TurnRow {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: 2,
      durationMs: 1,
      id,
      items: [
        {
          clientId: null,
          content: [{ text: "Render the response", text_elements: [], type: "text" }],
          id: `${id}-user`,
          type: "userMessage",
        },
        { id: `${id}-agent`, phase: "final_answer", text: source, type: "agentMessage" },
      ],
      startedAt: 1,
      status: "completed",
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnRow;
}

function completedConversationTurnWithActivityRow(id: string, source: string): TurnRow {
  const value: unknown = {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: 2,
      durationMs: 1,
      id,
      items: [
        {
          clientId: null,
          content: [{ text: "Render the response", text_elements: [], type: "text" }],
          id: `${id}-user`,
          type: "userMessage",
        },
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
        { id: `${id}-agent`, phase: "final_answer", text: source, type: "agentMessage" },
      ],
      itemsView: "full",
      startedAt: 1,
      status: "completed",
    },
  };
  // WHY: The generated protocol union has no narrow test factory, so the fixture cannot be
  // constructed safely while supplying only the fields consumed by the timeline projection.
  return value as TurnRow;
}

const enabled = {
  enabled: true,
  searchMessageItemId: null,
  threadSearchActive: false,
};

/** A turn with no user message: a background task woke the agent. */
function providerTurnRow(id: string, source: string, status: "completed" | "inProgress"): TurnRow {
  const row = status === "completed" ? turnRow(id, source) : streamingTurnRow(id, [
    { id: `${id}-agent`, phase: "final_answer", text: source, type: "agentMessage" },
  ]);
  return row;
}

describe("continued responses", () => {
  it("draws everything from one user message to the next as one bubble", () => {
    const head = completedConversationTurnRow("head", "First answer");
    const wake = providerTurnRow("wake", "Background task finished", "completed");
    const next = completedConversationTurnRow("next", "Another answer");
    const rows = projectTimelineRows([head, wake, next], enabled);
    const slices = rows.filter((row) => row.kind === "turnSlice");

    expect(slices.map((row) => [row.item.id, row.placement, row.bubble])).toEqual([
      ["head", "single", "start"],
      ["wake", "single", "end"],
      ["next", "single", "single"],
    ]);
    // The head's answer folds into the bubble's history; only the latest answer stays outside.
    expect(slices[0]).toMatchObject({
      group: { memberIndex: 0, members: [head, wake] },
      parts: [{ kind: "empty" }],
    });
    expect(slices[1]?.parts).toEqual([expect.objectContaining({ kind: "markdownBlock" })]);
    expect(slices[1]).toMatchObject({ group: { memberIndex: 1, members: [head, wake] } });
    expect(slices[2]).toMatchObject({ group: null });
    // The continuation still answers for its own turn.
    expect(timelineResponseStartRow(rows, "wake")?.key).toBe(timelineRowKey(slices[1]!));
  });

  it("streams a live continuation into the existing bubble without changing row keys", () => {
    const head = completedConversationTurnRow("head", "First answer");
    const alone = projectTimelineRows([head], enabled);
    const live = projectTimelineRows(
      [head, providerTurnRow("wake", "Working", "inProgress")],
      enabled,
    );

    expect(live[0]?.key).toBe(alone[0]?.key);
    expect(live.map((row) => (row.kind === "turnSlice" ? row.bubble : row.kind))).toEqual([
      "turnLead",
      "start",
      "end",
    ]);
    // While the continuation runs, the head's answer is still the latest one shown.
    expect(live[1]).toMatchObject({ parts: [expect.objectContaining({ kind: "markdownBlock" })] });
  });

  it("keeps a turn without a user message alone when nothing precedes it", () => {
    const rows = projectTimelineRows(
      [providerTurnRow("wake", "Background task finished", "completed")],
      enabled,
    );
    expect(rows).toMatchObject([{ bubble: "single", group: null, kind: "turnSlice" }]);
  });
});

describe("feature-flagged conversation rows", () => {
  it("uses the measured cold-row mean as the dynamic fallback", () => {
    expect(timelineRowSizeEstimate()).toBe(115);
  });

  it("keeps the ordinary renderer when the feature flag is disabled", () => {
    const item = turnRow("large", LARGE_MARKDOWN);
    expect(
      projectTimelineRows([item], {
        ...enabled,
        enabled: false,
      }),
    ).toMatchObject([{ item, kind: "item", timelineIndex: 0 }]);
  });

  it("uses the unified model for a short response", () => {
    const item = turnRow("short", "Short response");
    const rows = projectTimelineRows([item], enabled);

    expect(rows).toMatchObject([
      {
        item,
        kind: "turnSlice",
        parts: [{ kind: "markdownBlock" }],
        placement: "single",
      },
    ]);
  });

  it("splits a stable full-width response and preserves one semantic turn", () => {
    const item = turnRow("large", LARGE_MARKDOWN);
    const rows = projectTimelineRows([item], enabled);

    expect(rows.length).toBeGreaterThan(8);
    expect(rows[0]).toMatchObject({ item, kind: "turnSlice", placement: "start" });
    expect(rows.at(-1)).toMatchObject({ item, kind: "turnSlice", placement: "end" });
    expect(new Set(rows.map((row) => row.timelineIndex))).toEqual(new Set([0]));
  });

  it("uses the same model for search and streaming turns", () => {
    const completed = turnRow("completed", LARGE_MARKDOWN);
    const streaming = turnRow("streaming", LARGE_MARKDOWN, "inProgress");

    expect(
      projectTimelineRows([completed], { ...enabled, threadSearchActive: true }),
    ).toMatchObject([{ kind: "turnSlice", placement: "single" }]);
    expect(projectTimelineRows([streaming], enabled)).toMatchObject([
      { kind: "turnSlice", placement: "single" },
    ]);
  });

  it("makes the agent response a first-class anchor after the user row", () => {
    const item = streamingTurnRow("anchored", [
      {
        clientId: null,
        content: [{ text: "Explain the result", text_elements: [], type: "text" }],
        id: "user-anchor",
        type: "userMessage",
      },
      {
        id: "agent-anchor",
        memoryCitation: null,
        phase: "commentary",
        text: "The result starts here",
        type: "agentMessage",
      },
    ]);
    const rows = projectTimelineRows([item], enabled);

    expect(rows).toMatchObject([
      { item, kind: "turnLead" },
      { followsLead: true, item, kind: "turnSlice", placement: "single" },
    ]);
    expect(timelineResponseStartRow(rows, item.id)).toEqual({ index: 1, key: rows[1]?.key });
  });

  it("preserves unchanged row identity across outer timeline snapshots", () => {
    const stable = completedConversationTurnRow("stable", "Stable response");
    const changing = completedConversationTurnRow("changing", "First response");
    const first = projectTimelineRows([stable, changing], enabled);
    const second = projectTimelineRows(
      [stable, completedConversationTurnRow("changing", "Updated response")],
      enabled,
    );

    // Lead and response rows of the unchanged turn keep their identity.
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[3]).not.toBe(first[3]);
  });

  it("keeps the physical row key stable when a streaming message gains a tool call", () => {
    const userMessage = {
      clientId: null,
      content: [{ text: "Run the tests", text_elements: [], type: "text" }],
      id: "user-1",
      type: "userMessage",
    };
    const agentMessage = {
      id: "agent-1",
      memoryCitation: null,
      phase: "commentary",
      text: "Working",
      type: "agentMessage",
    };
    const toolCall = {
      aggregatedOutput: "",
      command: "pnpm test",
      durationMs: null,
      id: "tool-1",
      status: "inProgress",
      type: "commandExecution",
    };
    const before = projectTimelineRows(
      [streamingTurnRow("streaming-with-tool", [userMessage, agentMessage])],
      enabled,
    );
    const after = projectTimelineRows(
      [streamingTurnRow("streaming-with-tool", [userMessage, agentMessage, toolCall])],
      enabled,
    );

    expect(before.filter((row) => row.kind === "turnSlice")).toMatchObject([
      { kind: "turnSlice", parts: [{ kind: "markdownBlock" }], placement: "single" },
    ]);
    expect(after.filter((row) => row.kind === "turnSlice")).toMatchObject([
      {
        kind: "turnSlice",
        parts: [{ kind: "markdownBlock" }, { kind: "activity" }],
        placement: "single",
      },
    ]);
    const beforeRow = before.find((row) => row.kind === "turnSlice");
    const afterRow = after.find((row) => row.kind === "turnSlice");
    if (beforeRow === undefined || afterRow === undefined) {
      throw new Error("Expected one projected row before and after the streaming update");
    }
    expect(timelineRowKey(afterRow)).toBe(timelineRowKey(beforeRow));
  });

  it("reprojects a stable item when pagination changes its timeline index", () => {
    const prepended = turnRow("prepended", "Earlier response");
    const stable = turnRow("stable-index", "Stable response");
    const before = projectTimelineRows([stable], enabled);
    const after = projectTimelineRows([prepended, stable], enabled);

    expect(after[1]).not.toBe(before[0]);
    expect(after[1]?.timelineIndex).toBe(1);
  });

  it("uses Pretext as the cached owner of wrapped text height", () => {
    const rows = projectTimelineRows(
      [completedConversationTurnRow("premeasure-cache", LARGE_MARKDOWN)],
      enabled,
    );
    const row = rows.find(
      (candidate) =>
        candidate.kind === "turnSlice" &&
        candidate.placement === "middle" &&
        candidate.parts[0]?.kind === "markdownBlock" &&
        candidate.parts[0].block.node.type === "paragraph",
    );
    if (row === undefined) {
      throw new Error("Expected a stable middle paragraph row");
    }
    pretextMock.prepareInlineFlow.mockClear();
    pretextMock.walkInlineFlowLines.mockClear();
    const geometry = {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: 3,
      fontScale: 1,
      viewportWidth: 320,
    };

    expect(timelineRowHeight(row, geometry)).toEqual({
      size: 44,
      source: "calculated",
      status: "exact",
    });
    expect(timelineRowHeight(row, geometry)).toEqual({
      size: 44,
      source: "cache",
      status: "exact",
    });
    expect(pretextMock.prepareInlineFlow).toHaveBeenCalledTimes(1);
    expect(pretextMock.walkInlineFlowLines).toHaveBeenCalledTimes(1);
    expect(pretextMock.walkInlineFlowLines).toHaveBeenLastCalledWith(
      expect.anything(),
      224,
      expect.any(Function),
    );
    const part = row.parts[0];
    if (part?.kind !== "markdownBlock" || part.block.node.type !== "paragraph") {
      throw new Error("Expected the measured paragraph block");
    }
    const rendererLayout = layoutRichMarkdownInline(part.block.node, {
      fontScale: 1,
      width: 224,
    });
    expect(rendererLayout.status).toBe("exact");
    expect(layoutRichMarkdownInline(part.block.node, { fontScale: 1, width: 224 })).toBe(
      rendererLayout,
    );
    expect(pretextMock.prepareInlineFlow).toHaveBeenCalledTimes(1);
    expect(pretextMock.walkInlineFlowLines).toHaveBeenCalledTimes(1);

    expect(timelineRowHeight(row, { ...geometry, viewportWidth: 360 })).toEqual({
      size: 44,
      source: "calculated",
      status: "exact",
    });
    expect(timelineRowHeight(row, { ...geometry, fontScale: 1.2 })).toEqual({
      size: 52,
      source: "calculated",
      status: "exact",
    });
    expect(pretextMock.prepareInlineFlow).toHaveBeenCalledTimes(3);
  });

  it("keeps Pretext-backed text and code exact while unsupported rows stay dynamic", () => {
    const rows = projectTimelineRows(
      [completedConversationTurnRow("premeasure-fallback", LARGE_MARKDOWN)],
      enabled,
    );
    const start = rows.find(
      (candidate) => candidate.kind === "turnSlice" && candidate.placement === "start",
    );
    const code = rows.find(
      (candidate) =>
        candidate.kind === "turnSlice" &&
        candidate.placement === "middle" &&
        candidate.parts[0]?.kind === "markdownBlock" &&
        candidate.parts[0].block.node.type === "code",
    );
    const table = rows.find(
      (candidate) =>
        candidate.kind === "turnSlice" &&
        candidate.placement === "middle" &&
        candidate.parts[0]?.kind === "markdownBlock" &&
        candidate.parts[0].block.node.type === "table",
    );
    const end = rows.at(-1);
    if (
      start === undefined ||
      code === undefined ||
      table === undefined ||
      end?.kind !== "turnSlice"
    ) {
      throw new Error("Expected start, code, table, and end rows");
    }
    const geometry = {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: 3,
      fontScale: 1,
      viewportWidth: 320,
    };

    expect(timelineRowHeight(start, geometry)).toMatchObject({
      source: "calculated",
      status: "exact",
    });
    expect(timelineRowHeight(code, geometry)).toEqual({
      size: 64,
      source: "calculated",
      status: "exact",
    });
    expect(timelineRowHeight(table, geometry)).toMatchObject({
      estimate: expect.any(Number),
      reason: "markdown-table",
      status: "dynamic",
    });
    expect(timelineRowHeight(end, geometry)).toMatchObject({
      source: "calculated",
      status: "exact",
    });
  });

  it("keeps expandable history measurable while including its collapsed header in the estimate", () => {
    const plainRows = projectTimelineRows(
      [completedConversationTurnRow("plain-completed", "Final answer")],
      enabled,
    );
    const activityRows = projectTimelineRows(
      [completedConversationTurnWithActivityRow("activity-completed", "Final answer")],
      enabled,
    );
    const plain = plainRows.find((row) => row.kind === "turnSlice");
    const activity = activityRows.find((row) => row.kind === "turnSlice");
    if (plain?.kind !== "turnSlice" || activity?.kind !== "turnSlice") {
      throw new Error("Expected completed response rows");
    }
    const geometry = {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: 3,
      fontScale: 1,
      viewportWidth: 320,
    };
    const plainHeight = timelineRowHeight(plain, geometry);
    const activityHeight = timelineRowHeight(activity, geometry);

    expect(plainHeight).toMatchObject({ status: "exact" });
    expect(activityHeight).toMatchObject({ reason: "expandable-history", status: "dynamic" });
    if (plainHeight.status !== "exact" || activityHeight.status !== "dynamic") {
      throw new Error("Expected fixed plain response and measurable expandable history");
    }
    expect(activityHeight.estimate - plainHeight.size).toBe(20);
    expect(timelineRowHeight(activity, geometry)).toEqual(activityHeight);
  });

  it("limits expandable-history measurement to the leading slice of a long answer", () => {
    const source = "First paragraph\n\nSecond paragraph\n\nFinal paragraph";
    const rows = projectTimelineRows(
      [completedConversationTurnWithActivityRow("segmented-history", source)],
      enabled,
    ).filter((row) => row.kind === "turnSlice");
    const geometry = {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: 3,
      fontScale: 1,
      viewportWidth: 320,
    };
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(timelineRowHeight(row, geometry)).toMatchObject(
        row.placement === "start"
          ? { reason: "expandable-history", status: "dynamic" }
          : { status: "exact" },
      );
    }
  });

  it.each([
    { itemsView: "summary", kinds: ["commandExecution"], expected: "dynamic" },
    { itemsView: "summary", kinds: ["reasoning"], expected: "exact" },
    { itemsView: "full", kinds: ["commandExecution"], expected: "exact" },
  ] as const)(
    "uses visible history authority for $itemsView / $kinds instead of fixing unloaded history",
    ({ itemsView, kinds, expected }) => {
      const base = completedConversationTurnRow("summary-history", "Final answer");
      const turn: TurnRow["turn"] & { readonly codewide: ProjectedTurnMetadata } = {
        ...base.turn,
        codewide: { activity: { count: 1, kinds } },
        itemsView,
      };
      const rows = projectTimelineRows([{ ...base, turn }], enabled);
      const row = rows.find((candidate) => candidate.kind === "turnSlice");
      if (row === undefined) {
        throw new Error("Expected completed response row");
      }
      const result = timelineRowHeight(row, {
        agentDateVisible: false,
        beforeDateVisible: false,
        density: 3,
        fontScale: 1,
        viewportWidth: 320,
      });
      expect(result.status).toBe(expected);
      if (expected === "dynamic") {
        expect(result).toMatchObject({ reason: "expandable-history" });
      }
    },
  );

  it("estimates dynamic tables from their row and cell content instead of one global size", () => {
    const shortRows = projectTimelineRows(
      [turnRow("short-table", "Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter")],
      enabled,
    );
    const tallRows = projectTimelineRows(
      [
        turnRow(
          "tall-table",
          `Before

| A | B |
| --- | --- |
| ${"long cell content ".repeat(20)} | 2 |
| 3 | ${"another long cell ".repeat(16)} |
| 5 | 6 |

After`,
        ),
      ],
      enabled,
    );
    const findTable = (rows: ReturnType<typeof projectTimelineRows>) =>
      rows.find(
        (row) =>
          row.kind === "turnSlice" &&
          row.parts[0]?.kind === "markdownBlock" &&
          row.parts[0].block.node.type === "table",
      );
    const shortTable = findTable(shortRows);
    const tallTable = findTable(tallRows);
    if (shortTable === undefined || tallTable === undefined) {
      throw new Error("Expected both table rows");
    }
    const geometry = {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: 3,
      fontScale: 1,
      viewportWidth: 320,
    };
    const short = timelineRowHeight(shortTable, geometry);
    const tall = timelineRowHeight(tallTable, geometry);

    expect(short).toMatchObject({ reason: "markdown-table", status: "dynamic" });
    expect(tall).toMatchObject({ reason: "markdown-table", status: "dynamic" });
    if (short.status !== "dynamic" || tall.status !== "dynamic") {
      throw new Error("Expected dynamic table estimates");
    }
    expect(tall.estimate).toBeGreaterThan(short.estimate * 2);
  });

  it("scales HTML and streaming estimates with the current content", () => {
    const html = parseRichMarkdown("<section>short</section>").root.children[0];
    const tallHtml = parseRichMarkdown(
      `<section>${"long native markup content ".repeat(80)}<img src="preview.png" /></section>`,
    ).root.children[0];
    if (html === undefined || tallHtml === undefined) {
      throw new Error("Expected HTML blocks");
    }
    const blockGeometry = {
      fontScale: 1,
      hiddenImageReferences: new Set<string>(),
      width: 224,
    };
    expect(estimateDynamicRichMarkdownBlock(tallHtml, blockGeometry)).toBeGreaterThan(
      estimateDynamicRichMarkdownBlock(html, blockGeometry) * 4,
    );

    pretextMock.walkInlineFlowLines
      .mockImplementationOnce(
        (
          prepared: readonly { readonly text?: string }[],
          _width: number,
          onLine: (line: { readonly fragments: readonly unknown[] }) => void,
        ) => {
          onLine({
            fragments: prepared.map((item, itemIndex) => ({
              gapBefore: 0,
              itemIndex,
              text: item.text ?? "",
            })),
          });
          return 1;
        },
      )
      .mockImplementationOnce(
        (
          prepared: readonly { readonly text?: string }[],
          _width: number,
          onLine: (line: { readonly fragments: readonly unknown[] }) => void,
        ) => {
          const fragments = prepared.map((item, itemIndex) => ({
            gapBefore: 0,
            itemIndex,
            text: item.text ?? "",
          }));
          for (let index = 0; index < 12; index += 1) {
            onLine({ fragments });
          }
          return 12;
        },
      );
    const shortProjection = projectTimelineRows([turnRow("short-stream", "Working")], enabled)[0];
    const longProjection = projectTimelineRows(
      [turnRow("long-stream", "Working ".repeat(120))],
      enabled,
    )[0];
    if (shortProjection?.kind !== "turnSlice" || longProjection?.kind !== "turnSlice") {
      throw new Error("Expected Markdown rows");
    }
    const shortRow = {
      ...shortProjection,
      parts: shortProjection.parts.map((part) =>
        part.kind === "markdownBlock" ? { ...part, streaming: true } : part,
      ),
    };
    const longRow = {
      ...longProjection,
      parts: longProjection.parts.map((part) =>
        part.kind === "markdownBlock" ? { ...part, streaming: true } : part,
      ),
    };
    const geometry = {
      agentDateVisible: false,
      beforeDateVisible: false,
      density: 3,
      fontScale: 1,
      viewportWidth: 320,
    };
    const short = timelineRowHeight(shortRow, geometry);
    const long = timelineRowHeight(longRow, geometry);
    expect(short).toMatchObject({ reason: "streaming", status: "dynamic" });
    expect(long).toMatchObject({ reason: "streaming", status: "dynamic" });
    if (short.status !== "dynamic" || long.status !== "dynamic") {
      throw new Error("Expected streaming estimates");
    }
    expect(long.estimate).toBeGreaterThan(short.estimate * 2);
  });

  it("measures supported Markdown blocks with Pretext and rejects dynamic renderers", () => {
    const root = parseRichMarkdown(`# Heading

Mixed **bold** and _italic_ with \`inline code\` and [a link](https://example.com).

> Quoted text

- First
- Second

\`\`\`ts
const value = 1;
\`\`\`

![Preview](https://example.com/preview.png)

\`\`\`mermaid
graph TD; A-->B;
\`\`\`

---

| Name | Value |
| --- | --- |
| a | b |

<section>Native markup</section>`).root;
    const results = new Map(
      root.children.map((node) => [
        node.type,
        measureRichMarkdownBlock(node, {
          fontScale: 1,
          hiddenImageReferences: new Set<string>(),
          width: 224,
        }),
      ]),
    );

    for (const type of ["heading", "paragraph", "blockquote", "list", "code", "thematicBreak"]) {
      expect(results.get(type), type).toMatchObject({ status: "exact" });
    }
    expect(results.get("table")).toEqual({ reason: "table", status: "dynamic" });
    expect(results.get("html")).toEqual({ reason: "html", status: "dynamic" });
  });

  it("projects mixed inline styles into one pretext flow", () => {
    const node = parseRichMarkdown("Plain **bold** _italic_ `code` [external](https://example.com)")
      .root.children[0];
    if (node === undefined) {
      throw new Error("Expected one Markdown paragraph");
    }
    pretextMock.prepareInlineFlow.mockClear();

    expect(
      measureRichMarkdownBlock(node, {
        fontScale: 1,
        hiddenImageReferences: new Set<string>(),
        width: 224,
      }),
    ).toMatchObject({ status: "exact" });
    expect(pretextMock.prepareInlineFlow).toHaveBeenCalledTimes(1);
    expect(pretextMock.prepareInlineFlow.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ style: expect.objectContaining({ fontFamily: "monospace" }) }),
        expect.objectContaining({
          style: expect.objectContaining({ fontFamily: "RobotoFlex-SemiBold" }),
        }),
        expect.objectContaining({ style: expect.objectContaining({ fontStyle: "italic" }) }),
      ]),
    );
  });
});
