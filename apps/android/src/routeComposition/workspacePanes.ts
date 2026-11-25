import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { createContext, useContext } from "react";

import { useEvent } from "../react/useEvent";
import type { PanePair } from "../ui/paneSplitSizes";
import { radii } from "../theme";
import type { ThreePanelsChrome, ThreePanelsPane, ThreePanelsVariant } from "../ui/threePanels";
import type { PaneArrangement } from "./paneGeometry";
import { usePaneRearrangement, type PaneMotionState } from "./paneMotion";
import type { WorkspaceTwoPanePresentation } from "./WorkspaceTwoPaneLayout";

/**
 * The workspace has exactly three panes. `left` holds a catalog, `center` the destination and
 * `right` an optional side pane the destination opens beside itself (the PR review chat). The
 * left and right panes are never visible at the same time.
 */
export type WorkspacePane = ThreePanelsPane;

/**
 * Which panes the frame shows (`ThreePanelsVariant`). Only a present pane can be fullscreen:
 * resolution falls back to a split when the requested pane is absent, so an absent fullscreen
 * pane is never published.
 */
export type WorkspacePaneVisibility = ThreePanelsVariant;

/**
 * The presentation a route layout hands its frame. The expanded kinds are the frame's own
 * placements of a fullscreen pane or a right pane covering the catalog, so no route requests them.
 */
export type WorkspaceFramePresentation = Exclude<
  WorkspaceTwoPanePresentation,
  { readonly kind: "wideCatalogExpanded" } | { readonly kind: "wideDetailExpanded" }
>;

/**
 * Actions a pane's owner declares for its pane. Every action is absent unless declared, so an
 * undeclared action can neither appear in the pane header nor be triggered.
 */
export type WorkspacePaneCapabilities = {
  /** The pane can close; the layout runs it as a rearrangement and leaves fullscreen first. */
  readonly close?: () => void;
  /** The pane can be shown alone. */
  readonly fullscreen?: true;
};

type RightPaneRegistration = { readonly key: number; readonly split: PanePair };

/** One frame's three-pane state; the frame creates it once and both pane levels feed it. */
export type WorkspacePaneOwner = {
  readonly fullscreen$: Observable<WorkspacePane | null>;
  /** Registration and selected split for the active destination. */
  readonly right$: Observable<RightPaneRegistration | null>;
};

export function createWorkspacePaneOwner(): WorkspacePaneOwner {
  return {
    fullscreen$: observable<WorkspacePane | null>(null),
    right$: observable<RightPaneRegistration | null>(null),
  };
}

/** Chooses which neighbour is visible while retaining the registered right pane. */
export function selectWorkspaceSplit(owner: WorkspacePaneOwner, split: PanePair): void {
  const registered = owner.right$.peek();
  if (registered !== null && registered.split !== split) {
    owner.right$.set({ key: registered.key, split });
  }
}

/** Restores a retained right pane on explicit navigation to it. */
export function useRevealParkedRightPane(): () => void {
  const layout = useContext(WorkspacePanesContext);
  const rearrange = usePaneRearrangement();
  return useEvent(() => {
    if (layout !== null && layout.owner.right$.peek()?.split === "left+center") {
      rearrange(() => {
        selectWorkspaceSplit(layout.owner, "center+right");
        layout.owner.fullscreen$.set(null);
      });
    }
  });
}

let nextRightPaneKey = 0;

/** A key that tells one destination's right pane apart from another's in the same frame. */
export function createRightPaneKey(): number {
  nextRightPaneKey += 1;
  return nextRightPaneKey;
}

/**
 * Resolves the panes for this frame. The registered side pane survives selecting the catalog
 * split or folding the screen. Fullscreen requests only apply to a present pane.
 */
export function resolveWorkspacePaneVisibility({
  fullscreen,
  multiPane,
  rightSplit,
}: {
  readonly fullscreen: WorkspacePane | null;
  readonly multiPane: boolean;
  readonly rightSplit: PanePair | null;
}): WorkspacePaneVisibility {
  if (!multiPane) {
    return rightSplit === "left+center" ? { kind: "stacked", stashedRight: true } : STACKED;
  }
  if (
    fullscreen === "center" ||
    fullscreen === "left" ||
    (fullscreen === "right" && rightSplit !== null)
  ) {
    return { kind: "fullscreen", pane: fullscreen };
  }
  return { kind: "split", panes: rightSplit ?? "left+center" };
}

/**
 * Where the frame places a route's presentation for the resolved visibility. A fullscreen left
 * pane shows the catalog alone; a fullscreen center or right pane, and a right pane beside the
 * center, cover the catalog while keeping it mounted.
 */
export function placeFramePresentation(
  presentation: WorkspaceFramePresentation,
  visibility: WorkspacePaneVisibility,
): WorkspaceTwoPanePresentation {
  if (presentation.kind !== "wide" || visibility.kind === "stacked") {
    return presentation;
  }
  if (visibility.kind === "fullscreen") {
    return visibility.pane === "left"
      ? { kind: "wideCatalogExpanded" }
      : { kind: "wideDetailExpanded" };
  }
  return visibility.panes === "center+right" ? { kind: "wideDetailExpanded" } : presentation;
}

/**
 * The center surface rounds the side of its one visible neighbouring pane. This is the single
 * radius rule: the frame applies `left` to the center's leading edge and the center layout applies
 * `right` beside the right pane, so both sides share one token and one spring.
 */
function centerCornerRadii(visibility: WorkspacePaneVisibility): {
  readonly left: number;
  readonly right: number;
} {
  if (visibility.kind !== "split") {
    return { left: 0, right: 0 };
  }
  return visibility.panes === "left+center"
    ? { left: radii.composer, right: 0 }
    : { left: 0, right: radii.composer };
}

/** Where the right pane sits relative to the center surface. */
export type RightPanePlacement = "beside" | "cover" | "stashed";

/**
 * Beside the center in a `center+right` split; over the center on a phone or when it is
 * fullscreen; otherwise stashed.
 */
export function rightPanePlacement(visibility: WorkspacePaneVisibility): RightPanePlacement {
  if (visibility.kind === "stacked") {
    return visibility.stashedRight === true ? "stashed" : "cover";
  }
  if (visibility.kind === "fullscreen") {
    return visibility.pane === "right" ? "cover" : "stashed";
  }
  return visibility.panes === "center+right" ? "beside" : "stashed";
}

/** The wide presentations keep the catalog at its sidebar width wherever it is shown. */
const SIDEBAR: Readonly<Record<WorkspaceTwoPanePresentation["kind"], boolean>> = {
  catalogOnly: false,
  detailOnly: false,
  stacked: false,
  wide: true,
  wideCatalogExpanded: true,
  wideDetailExpanded: true,
};

const LEFT_PLACEMENT: Readonly<
  Record<WorkspaceTwoPanePresentation["kind"], PaneArrangement["left"]>
> = {
  catalogOnly: "alone",
  detailOnly: "covered",
  stacked: "under",
  wide: "beside",
  wideCatalogExpanded: "alone",
  wideDetailExpanded: "covered",
};

/**
 * The settled arrangement of all three panes for a placed presentation (`placeFramePresentation`)
 * and its visibility: the single target the frame's pane motion springs to. A right pane beside
 * the center always comes with a covered left pane.
 */
export function resolvePaneArrangement({
  presentation,
  rightPresent,
  visibility,
}: {
  readonly presentation: WorkspaceTwoPanePresentation;
  readonly rightPresent: boolean;
  readonly visibility: WorkspacePaneVisibility;
}): PaneArrangement {
  const corners = centerCornerRadii(visibility);
  const placement = rightPanePlacement(visibility);
  return {
    centerLeftRadius: corners.left,
    centerRightRadius: corners.right,
    left: LEFT_PLACEMENT[presentation.kind],
    right: !rightPresent || placement === "stashed" ? "offscreen" : placement,
    sidebar: SIDEBAR[presentation.kind],
  };
}

/** The frame's owner, resolved visibility and pane motion; `null` outside a pane frame. */
export const WorkspacePanesContext = createContext<{
  readonly geometry: PaneMotionState;
  readonly owner: WorkspacePaneOwner;
  readonly visibility: WorkspacePaneVisibility;
} | null>(null);

/** A retained side pane handles navigation only while its content is visible. */
export function useRightPaneVisible(mounted: boolean): boolean {
  const layout = useContext(WorkspacePanesContext);
  return mounted && rightPanePlacement(layout?.visibility ?? STACKED) !== "stashed";
}

/**
 * A pane's declared actions resolved against the current visibility; the pane provider publishes
 * the result through `ThreePanelsContext`.
 */
export function useWorkspacePaneChrome({
  capabilities,
  label,
  pane,
}: {
  readonly capabilities: WorkspacePaneCapabilities;
  readonly label: string;
  readonly pane: WorkspacePane;
}): ThreePanelsChrome {
  const layout = useContext(WorkspacePanesContext);
  const rearrange = usePaneRearrangement();
  const visibility = layout?.visibility ?? STACKED;
  const { fullscreen, fullscreenAvailable } = paneFullscreen(capabilities, visibility, pane);
  const toggleFullscreen = useEvent((): void => {
    rearrange(() => {
      layout?.owner.fullscreen$.set(fullscreen ? null : pane);
    });
  });
  const close = useEvent((): void => {
    closePane({ capabilities, owner: layout?.owner ?? null, pane, rearrange, visibility });
  });
  return {
    close: capabilities.close === undefined ? null : close,
    fullscreen,
    label,
    toggleFullscreen: fullscreenAvailable ? toggleFullscreen : null,
  };
}

const STACKED: WorkspacePaneVisibility = { kind: "stacked" };

/**
 * A pane the split shows can enter fullscreen, and only the fullscreen pane can leave it. A
 * covered left pane offers nothing.
 */
function paneFullscreen(
  capabilities: WorkspacePaneCapabilities,
  visibility: WorkspacePaneVisibility,
  pane: WorkspacePane,
): { readonly fullscreen: boolean; readonly fullscreenAvailable: boolean } {
  const fullscreen = visibility.kind === "fullscreen" && visibility.pane === pane;
  return {
    fullscreen,
    fullscreenAvailable:
      capabilities.fullscreen === true &&
      ((visibility.kind === "split" && splitShows(visibility.panes, pane)) || fullscreen),
  };
}

/** A split shows the center beside exactly one neighbour. */
function splitShows(
  panes: Extract<WorkspacePaneVisibility, { readonly kind: "split" }>["panes"],
  pane: WorkspacePane,
): boolean {
  return pane === "center" || pane === (panes === "left+center" ? "left" : "right");
}

/** Leaves the pane's fullscreen and closes it in one rearrangement; a phone moves no panes. */
function closePane({
  capabilities,
  owner,
  pane,
  rearrange,
  visibility,
}: {
  readonly capabilities: WorkspacePaneCapabilities;
  readonly owner: WorkspacePaneOwner | null;
  readonly pane: WorkspacePane;
  readonly rearrange: (change: () => void) => void;
  readonly visibility: WorkspacePaneVisibility;
}): void {
  const declared = capabilities.close;
  if (declared === undefined) {
    return;
  }
  const change = (): void => {
    if (owner?.fullscreen$.peek() === pane) {
      owner.fullscreen$.set(null);
    }
    declared();
  };
  if (visibility.kind === "stacked") {
    change();
  } else {
    rearrange(change);
  }
}

/** Subscribes the frame to its owner's fullscreen request and right-pane presence. */
export function useWorkspacePaneOwnerState(owner: WorkspacePaneOwner): {
  readonly fullscreen: WorkspacePane | null;
  readonly rightSplit: PanePair | null;
} {
  const fullscreen = useSelector(() => owner.fullscreen$.get());
  const rightSplit = useSelector(() => owner.right$.get()?.split ?? null);
  return { fullscreen, rightSplit };
}
