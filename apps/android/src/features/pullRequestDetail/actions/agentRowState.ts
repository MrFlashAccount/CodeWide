/**
 * What one Agent section row shows, from the catalog action, its live scenario view and the
 * screen's pending start. A queued or running run wins (its chat stays reachable even when the
 * catalog disables a new start); then the catalog's disabled reason; then a start in flight;
 * then the last finished or failed run at the shown head.
 */
import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { ThreadId } from "../../../data/reviewContract";
import { ageAgo } from "../../../ui/relativeAge";
import type { ScenarioView } from "./scenarioRuns";

/** One row's state; each kind carries only what that row can show. */
export type AgentRowState =
  | { readonly kind: "active"; readonly startedAt: string | null; readonly threadId: ThreadId }
  | { readonly kind: "disabled"; readonly reason: string }
  | { readonly finishedAt: string; readonly kind: "done" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "idle" }
  | { readonly kind: "starting" };

/** The row state of `action`; `pending` is the screen's in-flight start of it. */
export function agentRowState(
  action: ActionDescriptor,
  view: ScenarioView,
  pending: boolean,
): AgentRowState {
  if (view.kind === "active") {
    return view;
  }
  if (action.availability.state === "disabled") {
    return { kind: "disabled", reason: action.availability.reason };
  }
  if (pending) {
    return { kind: "starting" };
  }
  return view;
}

/**
 * The row's second line: a running run's start age, a finished run's age or failure, or the
 * catalog's disabled reason.
 */
export function agentRowDetail(state: AgentRowState, nowMs: number): string | null {
  if (state.kind === "active") {
    const age = state.startedAt === null ? "" : ageAgo(state.startedAt, nowMs);
    return age === "" ? "open chat" : `Started ${age} · open chat`;
  }
  if (state.kind === "done") {
    const age = ageAgo(state.finishedAt, nowMs);
    return age === "" ? "open chat" : `${age} · open chat`;
  }
  if (state.kind === "disabled" || state.kind === "failed") {
    return state.reason;
  }
  return null;
}

/** The state half of the row's accessibility label, `<Action>, <state>`. */
export function agentRowStateLabel(state: AgentRowState, nowMs: number): string {
  if (state.kind === "disabled") {
    return `unavailable: ${state.reason}`;
  }
  if (state.kind === "done") {
    const age = ageAgo(state.finishedAt, nowMs);
    return age === "" ? "done, opens the chat" : `done ${age}, opens the chat`;
  }
  if (state.kind === "failed") {
    return `failed: ${state.reason}, opens the chat`;
  }
  return STATE_WORDS[state.kind];
}

const STATE_WORDS: Readonly<Record<"active" | "idle" | "starting", string>> = {
  active: "running, opens the chat",
  idle: "not started",
  starting: "starting",
};

/** What a press on the row body does: open the run's chat, start the action, or nothing. */
export type AgentRowIntent =
  | { readonly kind: "none" }
  | { readonly kind: "openChat"; readonly threadId: ThreadId | null }
  | { readonly kind: "run" };

/**
 * A running row opens its run's chat; a settled one opens the PR's review chat, where its run
 * posted (the settled view names no thread); an idle row starts; a disabled or starting one
 * does nothing.
 */
export function agentRowIntent(state: AgentRowState): AgentRowIntent {
  if (state.kind === "active") {
    return { kind: "openChat", threadId: state.threadId };
  }
  if (state.kind === "done" || state.kind === "failed") {
    return { kind: "openChat", threadId: null };
  }
  return state.kind === "idle" ? { kind: "run" } : { kind: "none" };
}
