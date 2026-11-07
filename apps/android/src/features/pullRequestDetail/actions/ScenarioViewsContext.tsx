import { createContext, useContext } from "react";

import type { ScenarioView, ScenarioViews } from "./scenarioRuns";

const NO_VIEWS: ScenarioViews = new Map();
const IDLE: ScenarioView = { kind: "idle" };

/**
 * The PR screen's live scenario views, read by every catalog action button wherever the
 * action is slotted, so the row, the merge box and the checks sheet show one run state.
 */
export const ScenarioViewsContext = createContext<ScenarioViews>(NO_VIEWS);

/** The live view of one catalog action; idle outside a PR screen or for a forge action. */
export function useScenarioView(actionId: string): ScenarioView {
  return useContext(ScenarioViewsContext).get(actionId) ?? IDLE;
}
