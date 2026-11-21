/**
 * Effective confirmation of a catalog action: the plugin's level raised by the
 * kind floor. A floor can only raise a level; placement never changes it. The
 * companion recomputes the same level and rejects a lower confirmation.
 */
import type { ActionDescriptor, ActionKind, ConfirmLevel } from "../../../data/forgeActionCatalog";

/** Levels in increasing strength. */
const LEVELS: readonly ConfirmLevel[] = ["none", "confirm", "destructive"];

const KIND_FLOORS: Partial<Readonly<Record<ActionKind, ConfirmLevel>>> = {
  autoMerge: "confirm",
  close: "destructive",
  merge: "destructive",
  updateBranch: "confirm",
};

/** The higher of two levels. */
function maxConfirmLevel(left: ConfirmLevel, right: ConfirmLevel): ConfirmLevel {
  return LEVELS.indexOf(left) >= LEVELS.indexOf(right) ? left : right;
}

/** A plain auto-merge switch uses the provider's level. Other actions retain their kind floor. */
export function effectiveConfirmation(
  action: Pick<ActionDescriptor, "confirm" | "input" | "kind" | "toggle">,
): ConfirmLevel {
  if (action.kind === "autoMerge" && action.toggle !== null && action.input === null) {
    return action.confirm;
  }
  return maxConfirmLevel(action.confirm, KIND_FLOORS[action.kind] ?? "none");
}
