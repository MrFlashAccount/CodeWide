import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { createContext, useContext } from "react";

import { desktopThreadSidebarWidth } from "../presentation/layouts/windowLayout";
import type { ActionMenuIconName } from "../ui/ActionMenu.types";
import { useEvent } from "../react/useEvent";
import { radii } from "../theme";
import type { PaneArrangement } from "./paneGeometry";
import { usePaneRearrangement, type PaneMotionState } from "./paneMotion";
import type { WorkspaceTwoPanePresentation } from "./WorkspaceTwoPaneLayout";

/**
 * The workspace has exactly three panes. `left` holds a catalog, `center` the destination and
 * `right` an optional side pane the destination opens beside itself (the PR review chat). The
 * left and right panes are never visible at the same time.
 */
export type WorkspacePane = "left" | "center" | "right";

/**
 * The two panes a split shows side by side. The left and right panes are never visible together:
 * a present right pane covers the left pane, and closing it restores the left pane.
 */
type WorkspaceSplitPanes = "center+right" | "left+center";

/**
 * Which panes the frame shows. `stacked` is the one-pane-at-a-time phone layout: a right pane
 * covers the center. A `split` shows the center beside exactly one neighbour; `fullscreen` shows
 * one pane alone while the other two stay mounted. Only a present pane can be fullscreen:
 * resolution falls back to a split when the requested pane is absent, so an absent fullscreen
 * pane is never published.
 */
export type WorkspacePaneVisibility =
  | { readonly kind: "stacked" }
  | { readonly kind: "split"; readonly panes: WorkspaceSplitPanes }
  | { readonly kind: "fullscreen"; readonly pane: WorkspacePane };

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
 * undeclared action can neither appear in the pane menu nor be triggered.
 */
export type WorkspacePaneCapabilities = {
  /** The pane can close; the layout runs it as a rearrangement and leaves fullscreen first. */
  readonly close?: () => void;
  /** The pane can be shown alone. */
  readonly fullscreen?: true;
};

/** One item of a pane's menu, rendered by whatever draws that pane's header. */
type WorkspacePaneMenuItem = {
  readonly icon: ActionMenuIconName;
  readonly id: "fullscreen";
  readonly label: "Exit fullscreen" | "Fullscreen";
  readonly onSelect: () => void;
};

/** The declared actions of the current pane, resolved against the current visibility. */
export type WorkspacePaneChrome = {
  readonly close: (() => void) | null;
  readonly fullscreen: boolean;
  readonly menuItems: readonly WorkspacePaneMenuItem[];
  readonly toggleFullscreen: (() => void) | null;
};

/** One frame's three-pane state; the frame creates it once and both pane levels feed it. */
export type WorkspacePaneOwner = {
  readonly fullscreen$: Observable<WorkspacePane | null>;
  /** The key of the destination whose right pane is mounted and active. */
  readonly right$: Observable<number | null>;
};

export function createWorkspacePaneOwner(): WorkspacePaneOwner {
  return {
    fullscreen$: observable<WorkspacePane | null>(null),
    right$: observable<number | null>(null),
  };
}

let nextRightPaneKey = 0;

/** A key that tells one destination's right pane apart from another's in the same frame. */
export function createRightPaneKey(): number {
  nextRightPaneKey += 1;
  return nextRightPaneKey;
}

/**
 * Resolves the published visibility; a fullscreen request for an absent pane yields a split. A
 * multi-pane frame always has its catalog, so a split shows the right pane instead of the left
 * one whenever the right pane is present.
 */
export function resolveWorkspacePaneVisibility({
  fullscreen,
  multiPane,
  rightPresent,
}: {
  readonly fullscreen: WorkspacePane | null;
  readonly multiPane: boolean;
  readonly rightPresent: boolean;
}): WorkspacePaneVisibility {
  if (!multiPane) {
    return { kind: "stacked" };
  }
  if (
    fullscreen === "center" ||
    fullscreen === "left" ||
    (fullscreen === "right" && rightPresent)
  ) {
    return { kind: "fullscreen", pane: fullscreen };
  }
  return { kind: "split", panes: rightPresent ? "center+right" : "left+center" };
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
      ? { kind: "wideCatalogExpanded", viewportWidth: presentation.viewportWidth }
      : { kind: "wideDetailExpanded", viewportWidth: presentation.viewportWidth };
  }
  return visibility.panes === "center+right"
    ? { kind: "wideDetailExpanded", viewportWidth: presentation.viewportWidth }
    : presentation;
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
    return "cover";
  }
  if (visibility.kind === "fullscreen") {
    return visibility.pane === "right" ? "cover" : "stashed";
  }
  return visibility.panes === "center+right" ? "beside" : "stashed";
}

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
    sidebarWidth:
      "viewportWidth" in presentation ? desktopThreadSidebarWidth(presentation.viewportWidth) : 0,
  };
}

/** The frame's owner, resolved visibility and pane motion; `null` outside a pane frame. */
export const WorkspacePanesContext = createContext<{
  readonly geometry: PaneMotionState;
  readonly owner: WorkspacePaneOwner;
  readonly visibility: WorkspacePaneVisibility;
} | null>(null);

/** The pane a subtree renders in, with its owner's declared actions. */
export const WorkspacePaneContext = createContext<{
  readonly capabilities: WorkspacePaneCapabilities;
  readonly pane: WorkspacePane;
} | null>(null);

const NO_ITEMS: readonly WorkspacePaneMenuItem[] = [];
const STACKED: WorkspacePaneVisibility = { kind: "stacked" };
/** Outside any declared pane nothing is declared, so no action resolves. */
const UNDECLARED: {
  readonly capabilities: WorkspacePaneCapabilities;
  readonly pane: WorkspacePane;
} = { capabilities: {}, pane: "center" };

/** The current pane's declared actions, for whatever renders that pane's header. */
export function useWorkspacePaneChrome(): WorkspacePaneChrome {
  const { capabilities, pane } = useContext(WorkspacePaneContext) ?? UNDECLARED;
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
    menuItems: fullscreenAvailable ? [fullscreenItem(fullscreen, toggleFullscreen)] : NO_ITEMS,
    toggleFullscreen: fullscreenAvailable ? toggleFullscreen : null,
  };
}

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

function splitShows(panes: WorkspaceSplitPanes, pane: WorkspacePane): boolean {
  return pane === "center" || pane === (panes === "left+center" ? "left" : "right");
}

function fullscreenItem(fullscreen: boolean, onSelect: () => void): WorkspacePaneMenuItem {
  return fullscreen
    ? { icon: "contract-outline", id: "fullscreen", label: "Exit fullscreen", onSelect }
    : { icon: "expand-outline", id: "fullscreen", label: "Fullscreen", onSelect };
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
  readonly rightPresent: boolean;
} {
  const fullscreen = useSelector(() => owner.fullscreen$.get());
  const rightPresent = useSelector(() => owner.right$.get() !== null);
  return { fullscreen, rightPresent };
}
