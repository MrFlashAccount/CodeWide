import { act, render, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import {
  PerformanceExperimentProvider,
  resetPerformanceExperiments,
  setPerformanceExperiment,
} from "../src/data/performance-experiments";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { TurnTimelineItem } from "../src/features/conversation/turns/TurnTimelineItem";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { VirtualizedTurnTimelineItem } from "../src/features/conversation/turns/VirtualizedTurnTimelineItem";
import { controlSize, spacing, typeScale, typeWeight } from "../src/theme";
import { productFontStyle } from "../src/ui/Typography";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

function pendingTurn(): TurnItem {
  return {
    connectionId: "server",
    id: "turn",
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      error: null,
      id: "turn",
      items: [
        {
          clientId: null,
          content: [{ text: "Prompt", text_elements: [], type: "text" }],
          id: "prompt",
          type: "userMessage",
        },
      ],
      itemsView: "full",
      startedAt: 1,
      status: "inProgress",
    },
  };
}

function withReasoning(turn: TurnItem, summary: string[]): TurnItem {
  return {
    ...turn,
    turn: {
      ...turn.turn,
      items: [...turn.turn.items, { content: [], id: "reasoning", summary, type: "reasoning" }],
    },
  };
}

function turnView(turn: TurnItem, virtualized: boolean) {
  const props = { animateLiveUpdates: true, compact: false, requestPrompt: null, turn };
  const row = projectTimelineRows([turn], {
    enabled: virtualized,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).find((candidate) => candidate.kind === "turnSlice");
  if (virtualized && row?.kind !== "turnSlice") {
    throw new Error("Expected a physical agent slice for the virtualized turn");
  }
  const content =
    virtualized && row?.kind === "turnSlice" ? (
      <VirtualizedTurnTimelineItem
        {...props}
        followsLead={row.followsLead}
        forceExpanded={false}
        parts={row.parts}
        bubble={row.bubble}
        group={row.group}
        placement={row.placement}
        presentation={projectTurnPresentation(turn, null, false, false)}
      />
    ) : (
      <TurnTimelineItem {...props} />
    );
  return <PerformanceExperimentProvider>{content}</PerformanceExperimentProvider>;
}

afterEach(() => {
  act(() => resetPerformanceExperiments());
});

describe.each([false, true])("thinking handoff (virtualized: %s)", (virtualized) => {
  it.each([false, true])(
    "reserves the real thinking row geometry before the first reasoning item (reduced motion: %s)",
    (reducedMotion) => {
      act(() => setPerformanceExperiment("reduceCustomMotion", reducedMotion));
      const pending = pendingTurn();
      const view = render(turnView(pending, virtualized));
      const bubble = view.getByTestId("codex-bubble");
      const placeholder = view.getByTestId("turn-thinking-placeholder");
      const label = within(placeholder).getByText("Thinking", { includeHiddenElements: true });
      const icon = within(placeholder).getByTestId("inline-icon-slot");
      const placeholderStyle = StyleSheet.flatten(placeholder.props.style);
      const labelStyle = StyleSheet.flatten(label.props.style);
      const iconStyle = StyleSheet.flatten(icon.props.style);

      // These are native layout inputs, not simulated onLayout results: replacing a
      // pending label must not introduce a new icon, font, gap, or minimum row height.
      expect(placeholder).toHaveStyle({
        alignItems: "center",
        flexDirection: "row",
        gap: spacing.compact,
        minHeight: controlSize.compact,
        minWidth: 0,
        paddingHorizontal: 0,
      });
      expect(placeholderStyle.backgroundColor).toBeUndefined();
      expect(placeholderStyle.height).toBeUndefined();
      expect(labelStyle).toMatchObject({
        fontSize: typeScale.label.fontSize,
        lineHeight: typeScale.label.lineHeight,
        ...productFontStyle({ fontWeight: typeWeight.semibold }),
      });
      expect(label.props.allowFontScaling).toBe(true);
      expect(label.props.numberOfLines).toBe(1);
      expect(bubble).toHaveStyle({
        paddingBottom: spacing.sm,
        paddingHorizontal: spacing.md,
        paddingTop: spacing.sm,
      });
      expect(view.getByTestId("agent-bubble-frame")).not.toHaveStyle({ flexGrow: 1 });

      view.rerender(turnView(withReasoning(pending, []), virtualized));

      const thinking = view.getByTestId("thinking-status");
      expect(view.queryByTestId("turn-thinking-placeholder")).toBeNull();
      expect(view.getByTestId("codex-bubble") === bubble).toBe(true);
      expect(StyleSheet.flatten(thinking.props.style)).toEqual(placeholderStyle);
      expect(
        StyleSheet.flatten(within(thinking).getByTestId("inline-icon-slot").props.style),
      ).toEqual(iconStyle);
      expect(
        StyleSheet.flatten(
          within(thinking).getByText("Thinking", { includeHiddenElements: true }).props.style,
        ),
      ).toEqual(labelStyle);
      expect(view.getByTestId("agent-bubble-frame")).not.toHaveStyle({ flexGrow: 1 });

      view.rerender(
        turnView(withReasoning(pending, ["Checking the measured layout"]), virtualized),
      );
      const summary = within(view.getByTestId("thinking-status")).getByText(
        "Checking the measured layout",
        { includeHiddenElements: true },
      );
      expect(summary.props.numberOfLines).toBe(1);
      expect(StyleSheet.flatten(summary.props.style)).toEqual(labelStyle);
      expect(view.queryByTestId("turn-thinking-placeholder")).toBeNull();
    },
  );

  it("does not leave a pending thinking bubble after an empty turn completes", () => {
    const pending = pendingTurn();
    const view = render(turnView(pending, virtualized));
    expect(view.getByTestId("turn-thinking-placeholder")).toBeTruthy();
    view.rerender(
      turnView(
        {
          ...pending,
          turn: { ...pending.turn, completedAt: 2, durationMs: 1000, status: "completed" },
        },
        virtualized,
      ),
    );
    expect(view.queryByTestId("turn-thinking-placeholder")).toBeNull();
    expect(view.getByText("No response was generated")).toBeVisible();
  });
});
