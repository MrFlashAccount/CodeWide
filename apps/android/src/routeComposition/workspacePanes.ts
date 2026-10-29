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
 * `right` an optional side pane the destination opens beside itself (the PR review chat).
 */
export type WorkspacePane = "left" | "center" | "right";

/**
 * Which panes the frame shows. `stacked` is the one-pane-at-a-time phone layout: a right pane
 * covers the center. A `split` always shows the center; `fullscreen` shows one pane alone while
 * the other two stay mounted. Only a present pane can be fullscreen: resolution falls back to a
 * split when the requested pane is absent, so an absent fullscreen pane is never published.
 */
export type WorkspacePaneVisibility =
  | { readonly kind: "stacked" }
  | { readonly kind: "split"; readonly left: boolean; readonly right: boolean }
  | { readonly kind: "fullscreen"; readonly pane: WorkspacePane };

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

/** Resolves the published visibility; a fullscreen request for an absent pane yields a split. */
export function resolveWorkspacePaneVisibility({
  fullscreen,
  leftPresent,
  multiPane,
  rightPresent,
}: {
  readonly fullscreen: WorkspacePane | null;
  readonly leftPresent: boolean;
  readonly multiPane: boolean;
  readonly rightPresent: boolean;
}): WorkspacePaneVisibility {
  if (!multiPane) {
    return { kind: "stacked" };
  }
  if (
    fullscreen === "center" ||
    (fullscreen === "left" && leftPresent) ||
    (fullscreen === "right" && rightPresent)
  ) {
    return { kind: "fullscreen", pane: fullscreen };
  }
  return { kind: "split", left: leftPresent, right: rightPresent };
}

/**
 * The center surface rounds each side that has a visible neighbouring pane. This is the single
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
  return {
    left: visibility.left ? radii.composer : 0,
    right: visibility.right ? radii.composer : 0,
  };
}

/** Where the right pane sits relative to the center surface. */
export type RightPanePlacement = "beside" | "cover" | "stashed";

/** Beside in a split; over the center on a phone or when it is fullscreen; otherwise stashed. */
export function rightPanePlacement(visibility: WorkspacePaneVisibility): RightPanePlacement {
  if (visibility.kind === "stacked") {
    return "cover";
  }
  if (visibility.kind === "fullscreen") {
    return visibility.pane === "right" ? "cover" : "stashed";
  }
  return "beside";
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
 * The settled arrangement of all three panes for a placed presentation and its visibility: the
 * single target the frame's pane motion springs to.
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

/** A pane can enter fullscreen from a split, and only the fullscreen pane can leave it. */
function paneFullscreen(
  capabilities: WorkspacePaneCapabilities,
  visibility: WorkspacePaneVisibility,
  pane: WorkspacePane,
): { readonly fullscreen: boolean; readonly fullscreenAvailable: boolean } {
  const fullscreen = visibility.kind === "fullscreen" && visibility.pane === pane;
  return {
    fullscreen,
    fullscreenAvailable:
      capabilities.fullscreen === true && (visibility.kind === "split" || fullscreen),
  };
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
