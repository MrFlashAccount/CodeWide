import type { ActionKind } from "../../../data/forgeActionCatalog";
import type { LinkedThread } from "../../../data/forgePullRequestContract";
import type { ScenarioKind, ScenarioTarget } from "../workspaceCapabilities";

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

/**
 * Where a scenario continues by default: the single linked thread; among
 * several, the one thread linked by branch; otherwise a new thread when none is
 * linked. `null` means the user has to choose.
 */
export function defaultScenarioTarget(links: readonly LinkedThread[]): ScenarioTarget | null {
  const [only, ...others] = links;
  if (only === undefined) {
    return { kind: "newThread" };
  }
  if (others.length === 0) {
    return { kind: "thread", threadId: only.threadId };
  }
  const [branch, ...otherBranches] = links.filter((link) => link.source === "branch");
  return branch === undefined || otherBranches.length > 0
    ? null
    : { kind: "thread", threadId: branch.threadId };
}

/** The user's explicit choice while it is still a valid target, else the default. */
export function resolveScenarioTarget(
  links: readonly LinkedThread[],
  chosen: ScenarioTarget | null,
): ScenarioTarget | null {
  if (chosen?.kind === "newThread") {
    return chosen;
  }
  if (chosen !== null && links.some((link) => link.threadId === chosen.threadId)) {
    return chosen;
  }
  return defaultScenarioTarget(links);
}

/** Label of a scenario target; the dock chip and the send use the same target. */
export function scenarioTargetLabel(
  target: ScenarioTarget | null,
  describe: (threadId: LinkedThread["threadId"]) => string,
): string {
  if (target === null) {
    return "Choose thread";
  }
  return target.kind === "newThread" ? "New thread" : describe(target.threadId);
}

/** Every place a scenario can land: each linked thread, then a new thread. */
export function scenarioTargetChoices(links: readonly LinkedThread[]): readonly ScenarioTarget[] {
  return [
    ...links.map((link): ScenarioTarget => ({ kind: "thread", threadId: link.threadId })),
    { kind: "newThread" },
  ];
}
