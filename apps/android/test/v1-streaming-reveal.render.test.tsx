import { render } from "@testing-library/react-native";
import { StreamingRevealSurface } from "../src/rendering/StreamingRevealSurface";
import { projectTimelineRows } from "../src/features/conversation/timeline/timelineRows";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import { VirtualizedAgentTurnBody } from "../src/features/conversation/turns/VirtualizedAgentTurnBody";

type TurnItem = Extract<TimelineItem, { kind: "turn" }>;

function liveTurn(text: string): TurnItem {
  const value: unknown = {
    connectionId: "server",
    id: "turn",
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    threadId: "thread",
    turn: {
      completedAt: null,
      durationMs: null,
      id: "turn",
      items: [
        {
          clientId: null,
          content: [{ text: "Prompt", text_elements: [], type: "text" }],
          id: "prompt",
          type: "userMessage",
        },
        { id: "answer", phase: "commentary", text, type: "agentMessage" },
      ],
      startedAt: 1,
      status: "inProgress",
    },
  };
  // WHY: The generated protocol union has no narrow test factory for a turn with only one agent message.
  return value as TurnItem;
}

function renderLiveTurn(text: string, animateLiveUpdates: boolean) {
  const turn = liveTurn(text);
  const row = projectTimelineRows([turn], {
    enabled: true,
    searchMessageItemId: null,
    threadSearchActive: false,
  }).find((candidate) => candidate.kind === "turnSlice");
  if (row?.kind !== "turnSlice") {
    throw new Error("Expected one live response row");
  }
  return render(
    <VirtualizedAgentTurnBody
      animateLiveUpdates={animateLiveUpdates}
      compact={false}
      forceExpanded={false}
      getTransferAccess={undefined}
      onFixUnsupportedBlock={undefined}
      onLoadItems={undefined}
      parts={row.parts}
      placement={row.placement}
      presentation={projectTurnPresentation(turn, null, false, false)}
      requestPrompt={null}
      turn={turn}
    />,
  );
}

it("gives live Markdown a stable native text-reveal boundary", () => {
  const view = renderLiveTurn("A live answer", true);
  const surface = view.UNSAFE_getByType(StreamingRevealSurface);

  expect(surface.props.animateNew).toBe(true);
  expect(surface.props.streamKey).toContain("answer");
  expect(view.getByText("Rendered Markdown block")).toBeVisible();
});

it("keeps recovered live Markdown static until new updates are allowed", () => {
  const view = renderLiveTurn("A recovered answer", false);
  const surface = view.UNSAFE_getByType(StreamingRevealSurface);

  expect(surface.props.animateNew).toBe(false);
  expect(view.getByText("Rendered Markdown block")).toBeVisible();
});
