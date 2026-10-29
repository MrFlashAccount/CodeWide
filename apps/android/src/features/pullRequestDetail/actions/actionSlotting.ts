/**
 * Pure placement of a PR action catalog into bounded UI slots (N-07):
 * - plugin order inside each slot;
 * - action row: phone 1 primary + 2 secondary, tablet 2 + 3, and only as many
 *   as fit one line by measured width; excess degrades primary → secondary → ⋯;
 * - verdicts never enter the action row: they feed the review dock, default first;
 * - merge and auto-merge feed the native merge card;
 * - anchored actions sit on their target; a missing target goes to ⋯.
 * Placement never changes confirmation.
 */
import type { ActionAnchor, ActionDescriptor } from "../../../data/forgeActionCatalog";

/** Slot bounds and measurement of the current layout. */
export type SlotLayout = {
  /** Width available to the action row, excluding the ⋯ button. */
  readonly availableWidth: number;
  readonly gap: number;
  /** Measured width of one button with the given label, including padding. */
  readonly measure: (label: string, prominent: boolean) => number;
  readonly tablet: boolean;
};

/** Targets that exist on screen right now. */
export type SlotTargets = {
  readonly checkIds: ReadonlySet<string>;
  readonly conflict: boolean;
  readonly reviewThreadIds: ReadonlySet<string>;
};

/** Every place an action can appear. */
export type ActionSlots = {
  readonly anchored: {
    readonly checks: ReadonlyMap<string, readonly ActionDescriptor[]>;
    readonly conflict: readonly ActionDescriptor[];
    readonly files: ReadonlyMap<string, readonly ActionDescriptor[]>;
    readonly reviewThreads: ReadonlyMap<string, readonly ActionDescriptor[]>;
  };
  readonly autoMerge: ActionDescriptor | null;
  /** Merge methods, the group default first. */
  readonly merge: readonly ActionDescriptor[];
  readonly overflow: readonly ActionDescriptor[];
  readonly primary: readonly ActionDescriptor[];
  readonly secondary: readonly ActionDescriptor[];
  /** Verdicts for the review dock split button, the group default first. */
  readonly verdicts: readonly ActionDescriptor[];
};

/** Orders a group so its first `isDefault` member (in plugin order) leads. */
function defaultFirst(actions: readonly ActionDescriptor[]): readonly ActionDescriptor[] {
  const ordered = byOrder(actions);
  const index = ordered.findIndex((action) => action.isDefault);
  if (index <= 0) {
    return ordered;
  }
  const [leader] = ordered.splice(index, 1);
  return leader === undefined ? ordered : [leader, ...ordered];
}

/** Plugin order; sorting needs its own array so the catalog stays untouched. */
function byOrder(actions: readonly ActionDescriptor[]): ActionDescriptor[] {
  return [...actions].sort((left, right) => left.order - right.order);
}

function push<Key>(map: Map<Key, ActionDescriptor[]>, key: Key, action: ActionDescriptor): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [action]);
  } else {
    list.push(action);
  }
}

const PHONE_PRIMARY_SLOTS = 1;
const PHONE_SECONDARY_SLOTS = 2;
const TABLET_PRIMARY_SLOTS = 2;
const TABLET_SECONDARY_SLOTS = 3;

type MutableSlots = {
  readonly checks: Map<string, ActionDescriptor[]>;
  readonly conflict: ActionDescriptor[];
  readonly files: Map<string, ActionDescriptor[]>;
  readonly merge: ActionDescriptor[];
  readonly overflow: ActionDescriptor[];
  readonly reviewThreads: Map<string, ActionDescriptor[]>;
  readonly row: ActionDescriptor[];
  readonly verdicts: ActionDescriptor[];
};

/** Where an anchored action goes: a keyed target, the conflict banner, the row, or ⋯. */
type AnchorTarget =
  | {
      readonly key: string;
      readonly slot: "checks" | "files" | "reviewThreads";
    }
  | { readonly slot: "conflict" | "overflow" | "row" };

function anchorTarget(anchor: ActionAnchor, targets: SlotTargets): AnchorTarget {
  if (anchor.kind === "checks") {
    return targets.checkIds.has(anchor.checkId)
      ? { key: anchor.checkId, slot: "checks" }
      : { slot: "overflow" };
  }
  if (anchor.kind === "reviewThread") {
    return targets.reviewThreadIds.has(anchor.reviewThreadId)
      ? { key: anchor.reviewThreadId, slot: "reviewThreads" }
      : { slot: "overflow" };
  }
  if (anchor.kind === "file") {
    return { key: anchor.path, slot: "files" };
  }
  if (anchor.kind === "conflict") {
    return { slot: targets.conflict ? "conflict" : "overflow" };
  }
  return { slot: "row" };
}

/** Routes one action by kind first (verdict, merge), then by anchor, then by placement. */
function place(action: ActionDescriptor, targets: SlotTargets, slots: MutableSlots): void {
  if (action.kind === "verdict") {
    slots.verdicts.push(action);
    return;
  }
  if (action.kind === "merge") {
    slots.merge.push(action);
    return;
  }
  if (action.anchor === null) {
    (action.placement === "overflow" ? slots.overflow : slots.row).push(action);
    return;
  }
  const target = anchorTarget(action.anchor, targets);
  if ("key" in target) {
    push(slots[target.slot], target.key, action);
  } else {
    slots[target.slot].push(action);
  }
}

/** Places every catalog action exactly once. */
export function slotActions(
  actions: readonly ActionDescriptor[],
  targets: SlotTargets,
  layout: SlotLayout,
): ActionSlots {
  const ordered = byOrder(actions);
  const autoMerge = ordered.find((action) => action.kind === "autoMerge") ?? null;
  const slots: MutableSlots = {
    checks: new Map(),
    conflict: [],
    files: new Map(),
    merge: [],
    overflow: [],
    reviewThreads: new Map(),
    row: [],
    verdicts: [],
  };
  for (const action of ordered) {
    if (action !== autoMerge) {
      place(action, targets, slots);
    }
  }
  const row = fillActionRow(slots.row, layout);
  return {
    anchored: {
      checks: slots.checks,
      conflict: slots.conflict,
      files: slots.files,
      reviewThreads: slots.reviewThreads,
    },
    autoMerge,
    merge: defaultFirst(slots.merge),
    // Row overflow keeps plugin order alongside actions that asked for ⋯.
    overflow: byOrder([...row.overflow, ...slots.overflow]),
    primary: row.primary,
    secondary: row.secondary,
    verdicts: defaultFirst(slots.verdicts),
  };
}

type RowSlots = {
  readonly overflow: ActionDescriptor[];
  readonly primary: ActionDescriptor[];
  readonly secondary: ActionDescriptor[];
};

function fillActionRow(candidates: readonly ActionDescriptor[], layout: SlotLayout): RowSlots {
  const capacity = layout.tablet
    ? { primary: TABLET_PRIMARY_SLOTS, secondary: TABLET_SECONDARY_SLOTS }
    : { primary: PHONE_PRIMARY_SLOTS, secondary: PHONE_SECONDARY_SLOTS };
  const primaries = candidates
    .filter((action) => action.placement === "primary")
    .slice(0, capacity.primary);
  const result: RowSlots = { overflow: [], primary: [], secondary: [] };
  const width = { used: 0 };
  const fits = (action: ActionDescriptor): boolean => {
    const needed = layout.measure(action.label, false) + (width.used === 0 ? 0 : layout.gap);
    if (width.used + needed > layout.availableWidth) {
      return false;
    }
    width.used += needed;
    return true;
  };
  for (const action of primaries) {
    if (fits(action)) {
      result.primary.push(action);
    }
  }
  // Excess primaries degrade to secondary, then to ⋯, keeping plugin order.
  for (const action of candidates) {
    if (result.primary.includes(action)) {
      continue;
    }
    if (result.secondary.length < capacity.secondary && fits(action)) {
      result.secondary.push(action);
    } else {
      result.overflow.push(action);
    }
  }
  return result;
}
