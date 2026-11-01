import type { ReviewChatWorkspaceCandidate } from "../data/forgeMutationContract";

/** A scenario that starts in the review chat once the user confirms the draft's project. */
export type ReviewChatDraftScenario =
  | { readonly error: string | null; readonly label: string; readonly status: "pending" }
  | { readonly label: string; readonly status: "starting" };

/**
 * The review chat of a PR that has none yet, presented like a new chat. The thread is created
 * only by the first send or by the pending scenario's start, in the chosen project.
 */
export type ReviewChatDraft = {
  /** The project the chat will run in; there is no server default. */
  readonly cwd: string | null;
  /** The composer draft identity, stable for the route. */
  readonly id: string;
  readonly scenario: ReviewChatDraftScenario | null;
  /** The Companion's ranked projects for the PR; `null` until it answers. */
  readonly suggestions: readonly ReviewChatWorkspaceCandidate[] | null;
};

/** Publishes the Companion's suggestions, pre-selecting the first unless a project is chosen. */
export function withSuggestions(
  draft: ReviewChatDraft,
  suggestions: readonly ReviewChatWorkspaceCandidate[],
): ReviewChatDraft {
  return {
    cwd: draft.cwd ?? suggestions[0]?.path ?? null,
    id: draft.id,
    scenario: draft.scenario,
    suggestions,
  };
}

/** The draft with another project chosen. */
export function withProject(draft: ReviewChatDraft, cwd: string): ReviewChatDraft {
  return { cwd, id: draft.id, scenario: draft.scenario, suggestions: draft.suggestions };
}

/** The draft with its pending scenario replaced. */
export function withScenario(
  draft: ReviewChatDraft,
  scenario: ReviewChatDraftScenario | null,
): ReviewChatDraft {
  return { cwd: draft.cwd, id: draft.id, scenario, suggestions: draft.suggestions };
}
