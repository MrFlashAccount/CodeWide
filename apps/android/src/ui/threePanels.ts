import { createContext, useContext } from "react";

import type { PullRequestKey } from "../data/forgeContract";
import type { SurfaceTone } from "./surfaceTone";

/** The workspace's three panes: the catalog, the destination and the side pane it opens. */
export type ThreePanelsPane = "left" | "center" | "right";

/**
 * How the frame presents its panes. `stacked` is the one-pane-at-a-time phone layout, where a
 * right pane covers the center. A `split` shows the center beside exactly one neighbour; a
 * `fullscreen` shows one pane alone while the other two stay mounted.
 */
export type ThreePanelsVariant =
  | { readonly kind: "stacked" }
  | { readonly kind: "split"; readonly panes: "center+right" | "left+center" }
  | { readonly kind: "fullscreen"; readonly pane: ThreePanelsPane };

/**
 * The pane's declared actions, resolved against the variant. An undeclared action is `null`, so it
 * can neither appear nor be triggered.
 */
export type ThreePanelsChrome = {
  /** Closes the pane, leaving its fullscreen first; declared by right panes. */
  readonly close: (() => void) | null;
  /** The pane is currently shown alone. */
  readonly fullscreen: boolean;
  /** What the pane holds, for control labels (`Close review chat`). */
  readonly label: string;
  /** Enters or leaves fullscreen; `null` where the pane cannot be shown alone now. */
  readonly toggleFullscreen: (() => void) | null;
};

/**
 * What a pane shows, published by the owner that declares that pane. A conversation without a
 * thread is a new-chat draft that has not created its thread yet.
 */
export type ThreePanelsContent =
  | {
      readonly connectionId: string;
      readonly kind: "conversation";
      readonly threadId: string | null;
    }
  | {
      readonly connectionId: string;
      readonly kind: "pullRequest";
      readonly pullRequest: PullRequestKey;
    };

/** Where a subtree is placed in the three-pane workspace and what sits beside it. */
export type ThreePanels = {
  readonly chrome: ThreePanelsChrome;
  /** What the other pane of the same destination shows, while it is mounted. */
  readonly neighbour: ThreePanelsContent | null;
  readonly pane: ThreePanelsPane;
  /** The surface the pane is painted on; components never paint their own pane background. */
  readonly tone: SurfaceTone;
  readonly variant: ThreePanelsVariant;
};

/** Outside any declared pane: a standalone center with nothing declared and nothing beside it. */
const STANDALONE: ThreePanels = {
  chrome: { close: null, fullscreen: false, label: "", toggleFullscreen: null },
  neighbour: null,
  pane: "center",
  tone: "raised",
  variant: { kind: "stacked" },
};

/** Published by the pane frame for each pane's subtree; route composition is its only writer. */
export const ThreePanelsContext = createContext<ThreePanels>(STANDALONE);

/** The pane this component is placed in, its chrome, tone and neighbour. */
export function useThreePanels(): ThreePanels {
  return useContext(ThreePanelsContext);
}
