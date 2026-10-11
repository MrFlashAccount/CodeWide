import { fireEvent, render } from "@testing-library/react-native";
import { View } from "react-native";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { VirtualizedTurnTimelineItem } from "../src/features/conversation/turns/VirtualizedTurnTimelineItem";
import { StreamingRevealSurface } from "../src/rendering/StreamingRevealSurface";

// The normal presentation double ignores resetKey. These lifetime regressions require
// the real boundary, including the nested one owned by Bubble. The extension bypasses
// Jest's mapper for this requireActual only; production imports still resolve normally.
jest.mock("../src/ui/RecoverableRenderBoundary", () =>
  jest.requireActual<typeof import("../src/ui/RecoverableRenderBoundary")>(
    "../src/ui/RecoverableRenderBoundary.tsx",
  ),
);

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

function liveTurn(text: string, id = "turn"): TurnItem {
  return {
    connectionId: "server",
    id,
    key: `server/thread/${id}`,
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      error: null,
      id,
      items: [
        {
          clientId: null,
          content: [{ text: "Prompt", text_elements: [], type: "text" }],
          id: `${id}-prompt`,
          type: "userMessage",
        },
        {
          delivery: null,
          id: `${id}-answer`,
          memoryCitation: null,
          phase: "final_answer",
          questions: null,
          text,
          type: "agentMessage",
        },
      ],
      itemsView: "full",
      startedAt: 1,
      status: "inProgress",
    },
  };
}

function completedTurn(live: TurnItem): TurnItem {
  return {
    ...live,
    turn: { ...live.turn, completedAt: 2, durationMs: 1000, status: "completed" },
  };
}

function responseRows(turn: TurnItem) {
  return projectTimelineRows([turn], {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).filter((row) => row.kind === "turnSlice");
}

function responseSurface(
  turn: TurnItem,
  {
    animateLiveUpdates = true,
    latestAgentRef,
    onLatestAgentLayout,
  }: {
    animateLiveUpdates?: boolean;
    latestAgentRef?: (node: View | null) => void;
    onLatestAgentLayout?: () => void;
  } = {},
) {
  const presentation = projectTurnPresentation(turn, null, false, false);
  return (
    <View>
      {responseRows(turn).map((row) => (
        <VirtualizedTurnTimelineItem
          animateLiveUpdates={animateLiveUpdates}
          compact={false}
          followsLead={row.followsLead}
          forceExpanded={false}
          key={row.key}
          parts={row.parts}
          bubble={row.bubble}
          group={row.group}
          placement={row.placement}
          presentation={presentation}
          requestPrompt={null}
          turn={turn}
          {...(row.placement === "start" || row.placement === "single"
            ? { latestAgentRef, onLatestAgentLayout }
            : {})}
        />
      ))}
    </View>
  );
}

it.each([true, false])(
  "retains displayed text through completion, unread receipt and acknowledgement (animation: %s)",
  (animateLiveUpdates) => {
    const live = liveTurn("An answer already displayed during streaming.");
    const completed = completedTurn(live);
    const view = render(responseSurface(live, { animateLiveUpdates }));
    const displayedText = view.getByText("Rendered Markdown block");
    const bubble = view.getByTestId("codex-bubble");

    view.rerender(responseSurface(completed, { animateLiveUpdates }));
    expect(view.getByText("Rendered Markdown block") === displayedText).toBe(true);
    expect(view.UNSAFE_getByType(StreamingRevealSurface).props.animateNew).toBe(false);

    view.rerender(
      responseSurface(completed, {
        animateLiveUpdates,
        latestAgentRef: jest.fn(),
        onLatestAgentLayout: jest.fn(),
      }),
    );
    // The existing native text owns selection and layout. Receipt bookkeeping
    // must not replace it, even though all rendered text would still look equal.
    expect(view.getByText("Rendered Markdown block") === displayedText).toBe(true);
    expect(view.getByTestId("codex-bubble") === bubble).toBe(true);
    expect(displayedText).toBeVisible();

    view.rerender(responseSurface(completed, { animateLiveUpdates }));
    expect(view.getByText("Rendered Markdown block") === displayedText).toBe(true);
    expect(displayedText).toBeVisible();
  },
);

it("keeps an initially unread answer mounted when acknowledging it", () => {
  const completed = completedTurn(liveTurn("An answer opened while unread."));
  const view = render(
    responseSurface(completed, {
      latestAgentRef: jest.fn(),
      onLatestAgentLayout: jest.fn(),
    }),
  );
  const displayedText = view.getByText("Rendered Markdown block");

  view.rerender(responseSurface(completed));

  expect(view.getByText("Rendered Markdown block") === displayedText).toBe(true);
  expect(displayedText).toBeVisible();
});

it("retains the leading bubble and text when a completed response becomes multiple list rows", () => {
  const live = liveTurn(
    "## Heading\n\nParagraph before code.\n\n```ts\nconst stable = true;\n```\n\nFinal paragraph.",
  );
  const completed = completedTurn(live);
  expect(responseRows(live)).toHaveLength(1);
  expect(responseRows(completed).length).toBeGreaterThan(1);
  const view = render(responseSurface(live));
  const firstDisplayedText = view.getAllByText("Rendered Markdown block")[0];
  const displayedBlockCount = view.getAllByText("Rendered Markdown block").length;
  const bubble = view.getByTestId("codex-bubble");

  view.rerender(responseSurface(completed));

  expect(view.getAllByTestId("codex-bubble").length).toBeGreaterThan(1);
  expect(view.getAllByTestId("codex-bubble")[0] === bubble).toBe(true);
  expect(view.getAllByText("Rendered Markdown block")).toHaveLength(displayedBlockCount);
  expect(view.getAllByText("Rendered Markdown block")[0] === firstDisplayedText).toBe(true);
  expect(firstDisplayedText).toBeVisible();

  view.rerender(
    responseSurface(completed, {
      latestAgentRef: jest.fn(),
      onLatestAgentLayout: jest.fn(),
    }),
  );
  expect(view.getAllByText("Rendered Markdown block")[0] === firstDisplayedText).toBe(true);
});

it("keeps unread measurement callbacks attached only while observation is requested", () => {
  const completed = completedTurn(liveTurn("A visible answer."));
  const latestAgentRef = jest.fn();
  const onLatestAgentLayout = jest.fn();
  const measuredNode = { measureInWindow: jest.fn() };
  const view = render(responseSurface(completed), { createNodeMock: () => measuredNode });
  expect(latestAgentRef).not.toHaveBeenCalled();

  view.rerender(responseSurface(completed, { latestAgentRef, onLatestAgentLayout }));

  expect(latestAgentRef).toHaveBeenCalled();
  expect(typeof latestAgentRef.mock.calls.at(-1)?.[0]?.measureInWindow).toBe("function");
  const measurementView = view
    .UNSAFE_getAllByType(View)
    .find((node) => node.props.onLayout === onLatestAgentLayout);
  if (measurementView === undefined) {
    throw new Error("Expected the unread measurement view");
  }
  fireEvent(measurementView, "layout");
  expect(onLatestAgentLayout).toHaveBeenCalledTimes(1);

  view.rerender(responseSurface(completed));

  expect(latestAgentRef.mock.calls.at(-1)?.[0] === null).toBe(true);
  expect(
    view.UNSAFE_getAllByType(View).some((node) => node.props.onLayout === onLatestAgentLayout),
  ).toBe(false);
});

it("does not retain a response node across a genuinely different turn", () => {
  const first = completedTurn(liveTurn("First response.", "first"));
  const second = completedTurn(liveTurn("Second response.", "second"));
  const view = render(responseSurface(first));
  const firstDisplayedText = view.getByText("Rendered Markdown block");

  view.rerender(responseSurface(second));

  expect(view.getByText("Rendered Markdown block") === firstDisplayedText).toBe(false);
  expect(view.getByText("Rendered Markdown block")).toBeVisible();
});
