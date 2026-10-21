import type { LinkedThread } from "../../../data/forgePullRequestContract";
import {
  resolveScenarioTarget,
  scenarioTargetChoices,
  scenarioTargetLabel,
} from "../actions/scenarioTarget";
import type { ScenarioTarget } from "../workspaceCapabilities";

/** One entry of the dock chip's choice menu. */
type MessageTargetChoice = {
  readonly label: string;
  readonly selected: boolean;
  readonly target: ScenarioTarget;
};

/** Where the Overview dock writes, its chip label and the alternatives behind a long press. */
export type MessageDockTarget = {
  /** Empty when there is nothing to choose between (zero or one linked thread). */
  readonly choices: readonly MessageTargetChoice[];
  readonly label: string;
  /** `null` asks the user on send. */
  readonly target: ScenarioTarget | null;
};

function sameTarget(left: ScenarioTarget, right: ScenarioTarget | null): boolean {
  if (right === null || left.kind !== right.kind) {
    return false;
  }
  return left.kind === "newThread" || (right.kind === "thread" && left.threadId === right.threadId);
}

/**
 * The dock's target from one rule: the user's choice while valid, else the
 * default (single or branch-linked thread). The chip label and the send use
 * the same resolved target.
 */
export function messageDockTarget(
  links: readonly LinkedThread[],
  chosen: ScenarioTarget | null,
  describe: (threadId: LinkedThread["threadId"]) => string,
): MessageDockTarget {
  const target = resolveScenarioTarget(links, chosen);
  const choices =
    links.length > 1
      ? scenarioTargetChoices(links).map((choice) => ({
          label: scenarioTargetLabel(choice, describe),
          selected: sameTarget(choice, target),
          target: choice,
        }))
      : [];
  return { choices, label: scenarioTargetLabel(target, describe), target };
}
