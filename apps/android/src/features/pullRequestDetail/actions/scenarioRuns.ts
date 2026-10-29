/**
 * Maps the Companion's live scenario slot states onto the catalog's scenario actions for the
 * head this screen shows. A queued or running run is active at any head (a tap opens its
 * chat); a finished or failed run counts only for the head it started at, so a moved head
 * shows the plain action again.
 */
import type { ActionDescriptor } from "../../../data/forgeActionCatalog";
import type { HeadRevision } from "../../../data/forgeContract";
import type {
  PullRequestScenarios,
  ScenarioSlotState,
  SlotScenarioKind,
} from "../../../data/forgeScenarioContract";
import type { ThreadId } from "../../../data/reviewContract";
import { compactAge } from "../../../ui/relativeAge";
import { scenarioOf } from "./scenarioKind";

/** What one scenario action shows and does. */
export type ScenarioView =
  | { readonly kind: "idle" }
  | { readonly kind: "active"; readonly threadId: ThreadId }
  | { readonly finishedAt: string; readonly kind: "done" }
  | { readonly kind: "failed"; readonly reason: string };

/** Views by catalog `actionId`; an action without an entry is idle. */
export type ScenarioViews = ReadonlyMap<string, ScenarioView>;

const IDLE: ScenarioView = { kind: "idle" };

const ACTIVE_LABELS: Readonly<Record<SlotScenarioKind, string>> = {
  addressComments: "Addressing comments…",
  fixCi: "Fixing CI…",
  rebase: "Rebasing…",
  reviewPr: "Reviewing…",
};

const DONE_LABELS: Readonly<Record<SlotScenarioKind, string>> = {
  addressComments: "Comments addressed",
  fixCi: "CI fix done",
  rebase: "Rebased",
  reviewPr: "Reviewed",
};

/** The slot a whole-PR catalog action starts: its kind and, for `fixCi`, the anchored check. */
function slotOf(action: ActionDescriptor): {
  readonly checkId: string | null;
  readonly scenario: SlotScenarioKind;
} | null {
  const scenario = scenarioOf(action.kind);
  if (scenario === null || scenario === "message") {
    return null;
  }
  return {
    checkId: action.anchor?.kind === "checks" ? action.anchor.checkId : null,
    scenario,
  };
}

function viewOf(slot: ScenarioSlotState, head: HeadRevision): ScenarioView {
  const { state } = slot;
  if (state.status === "queued" || state.status === "running") {
    return { kind: "active", threadId: state.threadId };
  }
  if (state.status === "idle" || state.headRevision !== head) {
    return IDLE;
  }
  return state.status === "done"
    ? { finishedAt: state.finishedAt, kind: "done" }
    : { kind: "failed", reason: state.reason };
}

/** The view of every scenario action in `actions` for the shown `head`. */
export function scenarioViews(
  actions: readonly ActionDescriptor[],
  scenarios: PullRequestScenarios | null,
  head: HeadRevision,
): ScenarioViews {
  const views = new Map<string, ScenarioView>();
  if (scenarios === null) {
    return views;
  }
  for (const action of actions) {
    const slot = slotOf(action);
    const state =
      slot === null
        ? undefined
        : scenarios.scenarios.find(
            (candidate) =>
              candidate.scenario === slot.scenario &&
              candidate.checkId === slot.checkId &&
              candidate.reviewThreadId === null,
          );
    if (slot !== null && state !== undefined) {
      views.set(action.actionId, viewOf(state, head));
    }
  }
  return views;
}

/** The label a scenario action shows: `Reviewing…` while active, `Reviewed · 5m ago` once done. */
function scenarioLabel(action: ActionDescriptor, view: ScenarioView, nowMs: number): string {
  const slot = slotOf(action);
  if (slot === null || view.kind === "idle" || view.kind === "failed") {
    return action.label;
  }
  if (view.kind === "active") {
    return ACTIVE_LABELS[slot.scenario];
  }
  const age = compactAge(view.finishedAt, nowMs);
  const ago = age === "now" ? "just now" : `${age} ago`;
  return age === "" ? DONE_LABELS[slot.scenario] : `${DONE_LABELS[slot.scenario]} · ${ago}`;
}

/** The catalog with each scenario action labelled by its live state, for slotting and menus. */
export function withScenarioLabels(
  actions: readonly ActionDescriptor[],
  views: ScenarioViews,
  nowMs: number,
): readonly ActionDescriptor[] {
  if (views.size === 0) {
    return actions;
  }
  return actions.map((action) => {
    const view = views.get(action.actionId);
    return view === undefined ? action : { ...action, label: scenarioLabel(action, view, nowMs) };
  });
}

/** The first failed scenario action at the shown head, with the real reason. */
export function scenarioFailure(
  actions: readonly ActionDescriptor[],
  views: ScenarioViews,
): { readonly label: string; readonly reason: string } | null {
  for (const action of actions) {
    const view = views.get(action.actionId);
    if (view?.kind === "failed") {
      return { label: action.label, reason: view.reason };
    }
  }
  return null;
}
