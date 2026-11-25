import type { DraftComment } from "../../../data/reviewDraftContract";

/** Draft counts the review dock and Submit sheet show. */
export type DockCounts = {
  /** Agent-only drafts with an unsent agent half; Submit never sends them. */
  readonly agentOnly: number;
  /** Both drafts whose agent half is still pending; Submit may forward them. */
  readonly bothPending: number;
  /** Drafts whose PR axis Submit would publish (pending or failed). */
  readonly toPr: number;
  readonly total: number;
};

/** Counts drafts by what Submit does with them. */
export function dockCounts(drafts: readonly DraftComment[]): DockCounts {
  let agentOnly = 0;
  let bothPending = 0;
  let toPr = 0;
  let total = 0;
  for (const draft of drafts) {
    if (draft.destination === "agent") {
      if (draft.agent.state !== "sent") {
        agentOnly += 1;
        total += 1;
      }
      continue;
    }
    if (draft.pr.state === "pending" || draft.pr.state === "failed") {
      toPr += 1;
      total += 1;
      if (draft.destination === "both" && draft.agent.state === "pending") {
        bothPending += 1;
      }
    }
  }
  return { agentOnly, bothPending, toPr, total };
}

/** Ids Submit sends to the forge. */
export function submittableDraftIds(
  drafts: readonly DraftComment[],
): readonly DraftComment["id"][] {
  return drafts
    .filter(
      (draft) =>
        draft.destination !== "agent" &&
        (draft.pr.state === "pending" || draft.pr.state === "failed"),
    )
    .map((draft) => draft.id);
}
