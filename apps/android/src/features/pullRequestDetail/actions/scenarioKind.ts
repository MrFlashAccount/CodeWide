import type { ActionKind } from "../../../data/forgeActionCatalog";
import type { ScenarioKind } from "../workspaceCapabilities";

const SCENARIO_KINDS: Partial<Readonly<Record<ActionKind, ScenarioKind>>> = {
  addressComments: "addressComments",
  fixCi: "fixCi",
  rebase: "rebase",
  reviewPr: "reviewPr",
};

/** The agent scenario a catalog action starts, or `null` for a forge action. */
export function scenarioOf(kind: ActionKind): ScenarioKind | null {
  return SCENARIO_KINDS[kind] ?? null;
}
