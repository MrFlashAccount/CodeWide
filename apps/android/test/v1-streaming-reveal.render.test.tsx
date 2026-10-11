import { render } from "@testing-library/react-native";
import { RichMarkdownDocumentBlockView } from "../src/rendering/RichMarkdown";
import { StreamingRevealSurface } from "../src/rendering/StreamingRevealSurface";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { VirtualizedAgentTurnBody } from "../src/features/conversation/turns/VirtualizedAgentTurnBody";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

function liveTurn(text: string): TurnItem {
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
        {
          delivery: null,
          id: "answer",
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

function turnBody(turn: TurnItem, animateLiveUpdates: boolean) {
  const row = projectTimelineRows([turn], {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).find((candidate) => candidate.kind === "turnSlice");
  if (row?.kind !== "turnSlice") {
    throw new Error("Expected one response row");
  }
  return (
    <VirtualizedAgentTurnBody
      animateLiveUpdates={animateLiveUpdates}
      compact={false}
      forceExpanded={false}
      getTransferAccess={undefined}
      onFixUnsupportedBlock={undefined}
      onLoadItems={undefined}
      parts={row.parts}
      bubble={row.bubble}
      group={row.group}
      placement={row.placement}
      presentation={projectTurnPresentation(turn, null, false, false)}
      requestPrompt={null}
      turn={turn}
    />
  );
}

function renderLiveTurn(text: string, animateLiveUpdates: boolean) {
  return render(turnBody(liveTurn(text), animateLiveUpdates));
}

it("gives live Markdown a stable native text-reveal boundary", () => {
  const view = renderLiveTurn("A live answer", true);
  const surface = view.UNSAFE_getByType(StreamingRevealSurface);

  expect(surface.props.animateNew).toBe(true);
  expect(surface.props.streamKey).toContain("answer");
  expect(view.UNSAFE_getByType(RichMarkdownDocumentBlockView).props.animateStreaming).toBe(true);
  expect(view.getByText("Rendered Markdown block")).toBeVisible();
});

it("keeps recovered live Markdown static until new updates are allowed", () => {
  const view = renderLiveTurn("A recovered answer", false);
  const surface = view.UNSAFE_getByType(StreamingRevealSurface);

  expect(surface.props.animateNew).toBe(false);
  expect(view.UNSAFE_getByType(RichMarkdownDocumentBlockView).props.animateStreaming).toBe(false);
  expect(view.getByText("Rendered Markdown block")).toBeVisible();
});

it.each([true, false])(
  "keeps already displayed text mounted when the answer completes (live animation: %s)",
  (animateLiveUpdates) => {
    const live = liveTurn("A short final answer that already fits in the viewport.");
    const view = render(turnBody(live, animateLiveUpdates));
    const displayedText = view.getByText("Rendered Markdown block");
    const completed: TurnItem = {
      ...live,
      turn: { ...live.turn, completedAt: 2, durationMs: 1000, status: "completed" },
    };

    view.rerender(turnBody(completed, animateLiveUpdates));

    // The mounted text owns selection and native layout; completion must only stop reveal paint.
    expect(view.getByText("Rendered Markdown block") === displayedText).toBe(true);
    expect(displayedText).toBeVisible();
    expect(view.UNSAFE_getByType(StreamingRevealSurface).props.animateNew).toBe(false);
    expect(view.UNSAFE_getByType(RichMarkdownDocumentBlockView).props.animateStreaming).toBe(false);
  },
);
