import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineItem } from "../src/features/conversation/timeline/timelineTypes";
import { projectTurnPresentation } from "../src/features/conversation/turns/turnProjection";
import * as artifacts from "../src/rendering/agent-artifacts";

type TurnRow = Extract<TimelineItem, { kind: "turn" }>;
function message(id: string, text: string): TurnRow["turn"]["items"][number] {
  return {
    type: "agentMessage",
    id,
    text,
    phase: null,
    memoryCitation: null,
    delivery: null,
    questions: null,
  };
}
function row(status: TurnRow["turn"]["status"] = "completed"): TurnRow {
  return {
    connectionId: "server",
    threadId: "thread",
    id: "turn",
    key: "server/thread/turn",
    kind: "turn",
    scope: "server/thread",
    turn: {
      id: "turn",
      items: [message("earlier", "Earlier answer."), message("latest", "Current answer.")],
      itemsView: "full",
      status,
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1000,
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("shared turn preparation", () => {
  it("prepares one immutable revision once across slices and independent action/search intents", () => {
    const prepareArtifacts = vi.spyOn(artifacts, "projectAgentArtifacts");
    const item = row();
    const first = projectTurnPresentation(item, null, false, false);
    const sliceCount = 30;
    for (let slice = 0; slice < sliceCount; slice++) {
      const view = projectTurnPresentation(item, { itemId: "earlier" }, true, true);
      expect(view.copyText).toBe("Current answer.");
      expect(view.searchedAgentBlock?.body).toBe("Earlier answer.");
      expect(view.canForkThrough).toBe(true);
      expect(view.userBlocks).toBe(first.userBlocks);
      expect(view.liveMarkdownProjections).toBe(first.liveMarkdownProjections);
    }
    // Work budget: source-wide preparation occurs once per revision, not once per physical slice.
    expect(prepareArtifacts).toHaveBeenCalledTimes(1);
    expect(first.canForkThrough).toBe(false);
    expect(first.searchedAgentBlock).toBeNull();
    expect(
      projectTurnPresentation(item, { itemId: "latest" }, false, false).searchedAgentBlock,
    ).toBeNull();
  });

  it("rebuilds streamed text, completion and hydration for a new snapshot", () => {
    const item = row("inProgress");
    const first = projectTurnPresentation(item, null, true, false);
    const changed: TurnRow = {
      ...item,
      turn: { ...item.turn, items: [message("latest", "Replacement answer.")] },
    };
    const next = projectTurnPresentation(changed, null, true, false);
    expect(next.copyText).toBe("Replacement answer.");
    expect(next.canForkThrough).toBe(false);
    expect(next.liveMarkdownProjections).not.toBe(first.liveMarkdownProjections);
    const finished: TurnRow = { ...changed, turn: { ...changed.turn, status: "completed" } };
    const complete = projectTurnPresentation(finished, null, true, false);
    expect(complete.canForkThrough).toBe(true);
    expect(complete.canReviewResponse).toBe(true);
    expect(complete.visibleLiveActivitySequence).toEqual([]);
    expect(complete.copyText).toBe("Replacement answer.");
    const hydrated: TurnRow = {
      ...finished,
      turn: {
        ...finished.turn,
        items: [message("earlier", "Hydrated history."), ...finished.turn.items],
      },
    };
    expect(
      projectTurnPresentation(hydrated, { itemId: "earlier" }, false, false).searchedAgentBlock
        ?.body,
    ).toBe("Hydrated history.");
    expect(projectTurnPresentation(item, null, true, false).copyText).toBe("Current answer.");
  });

  it("does not retain request visibility or mix identical turn ids from different scopes", () => {
    const original = row("inProgress");
    const empty: TurnRow = { ...original, turn: { ...original.turn, items: [] } };
    expect(projectTurnPresentation(empty, null, false, false).hasAgentContent).toBe(false);
    expect(projectTurnPresentation(empty, null, false, true).hasAgentContent).toBe(true);
    expect(projectTurnPresentation(empty, null, false, false).hasAgentContent).toBe(false);
    const other: TurnRow = {
      ...original,
      connectionId: "other",
      key: "other/thread/turn",
      scope: "other/thread",
    };
    expect(projectTurnPresentation(other, null, false, false).latestAgentBlock?.key).not.toBe(
      projectTurnPresentation(original, null, false, false).latestAgentBlock?.key,
    );
  });
  it("does not duplicate the latest search hit after another scope reuses a raw item", () => {
    const original = row();
    projectTurnPresentation(original, null, false, false);
    const other: TurnRow = {
      ...original,
      connectionId: "other",
      key: "other/thread/turn",
      scope: "other/thread",
    };
    projectTurnPresentation(other, null, false, false);
    expect(
      projectTurnPresentation(original, { itemId: "latest" }, false, false).searchedAgentBlock,
    ).toBeNull();
  });
});

it("releases old preparations after a large history traversal without changing replayed output", () => {
  const prepareArtifacts = vi.spyOn(artifacts, "projectAgentArtifacts");
  const original = row();
  const before = projectTurnPresentation(original, null, false, false);
  for (let index = 0; index < 100; index++) {
    const item = row();
    projectTurnPresentation(item, null, false, false);
  }
  prepareArtifacts.mockClear();
  const replayed = projectTurnPresentation(original, null, false, false);
  expect(prepareArtifacts).toHaveBeenCalledTimes(1);
  expect(replayed).toEqual(before);
});
