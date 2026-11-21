import { useContext, type ReactNode } from "react";
import { PaneBodyModeContext, PaneBodyPlacementContext } from "../ui/paneBodyTransition";
import { PaneMotionContext, type PaneMotionState } from "./paneMotion";
import { interpolatePaneGeometry, paneGeometry, snapshotBodyMargin } from "./paneGeometry";
import { useDerivedValue } from "react-native-reanimated";

import { SurfaceToneProvider } from "../ui/surfaceTone";
import { ThreePanelsContext, type ThreePanelsContent } from "../ui/threePanels";
import { currentChromeInset } from "./paneFrames";
import type { PaneBox } from "./paneGeometry";
import {
  useWorkspacePaneChrome,
  WorkspacePanesContext,
  type WorkspacePane,
  type WorkspacePaneCapabilities,
} from "./workspacePanes";

/** The left and right panes sit on the frame color; the center is the raised destination. */
const PANE_TONE = { center: "raised", left: "recessed", right: "recessed" } as const;

/**
 * Publishes one pane's placement to its subtree through `ThreePanelsContext`: the pane position,
 * the frame's variant, the owner-declared chrome resolved against that variant, the chrome inset
 * of the pane box it sits in, the pane's surface tone and what the neighbouring pane of the same
 * destination shows.
 */
export function ThreePanelsPane({
  box,
  capabilities,
  children,
  label,
  neighbour,
  pane,
}: {
  /** The frame box whose content holds this pane, for the chrome inset while panes move. */
  readonly box: PaneBox;
  readonly capabilities: WorkspacePaneCapabilities;
  readonly children: ReactNode;
  /** What the pane holds, for its control labels. */
  readonly label: string;
  readonly neighbour: ThreePanelsContent | null;
  readonly pane: WorkspacePane;
}): React.JSX.Element {
  const panes = useContext(WorkspacePanesContext);
  const variant = panes?.visibility ?? STACKED;
  const geometry = panes?.geometry ?? null;
  const chrome = useWorkspacePaneChrome({ capabilities, label, pane });
  // One UI-thread derivation per pane; it recomputes only while the frame's progress moves.
  const chromeInset = useDerivedValue(() =>
    geometry === null ? 0 : currentChromeInset(geometry, box),
  );
  const tone = PANE_TONE[pane];
  const mode = useContext(PaneBodyModeContext);
  const surface = <SurfaceToneProvider value={tone}>{children}</SurfaceToneProvider>;
  return (
    <ThreePanelsContext.Provider value={{ chrome, chromeInset, neighbour, pane, tone, variant }}>
      {mode === "snapshot" && geometry !== null ? (
        <SnapshotPlacement box={box} geometry={geometry}>
          {surface}
        </SnapshotPlacement>
      ) : (
        surface
      )}
    </ThreePanelsContext.Provider>
  );
}

function SnapshotPlacement({
  box,
  children,
  geometry,
}: {
  readonly box: PaneBox;
  readonly children: ReactNode;
  readonly geometry: PaneMotionState;
}): React.JSX.Element {
  const { subscribeCapture } = useContext(PaneMotionContext);
  const finalMargin = useDerivedValue(() => {
    if (!geometry.moving.get()) {
      return 0;
    }
    const from = geometry.from.get();
    const to = paneGeometry(geometry.arrangement.get(), geometry.frameWidth.get());
    return snapshotBodyMargin(interpolatePaneGeometry(from, to, geometry.progress.get()), to, box);
  });
  return (
    <PaneBodyPlacementContext.Provider value={{ finalMargin, subscribeCapture }}>
      {children}
    </PaneBodyPlacementContext.Provider>
  );
}

const STACKED = { kind: "stacked" } as const;
