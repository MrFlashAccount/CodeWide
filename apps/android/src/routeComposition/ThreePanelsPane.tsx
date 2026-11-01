import { useContext, type ReactNode } from "react";
import { useDerivedValue } from "react-native-reanimated";

import { SurfaceToneProvider } from "../ui/surfaceTone";
import { ThreePanelsContext, type ThreePanelsContent } from "../ui/threePanels";
import { paneChromeInset, type PaneBox } from "./paneGeometry";
import { currentPaneGeometry } from "./paneMotion";
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
    geometry === null ? 0 : paneChromeInset(currentPaneGeometry(geometry), box),
  );
  const tone = PANE_TONE[pane];
  return (
    <ThreePanelsContext.Provider value={{ chrome, chromeInset, neighbour, pane, tone, variant }}>
      <SurfaceToneProvider value={tone}>{children}</SurfaceToneProvider>
    </ThreePanelsContext.Provider>
  );
}

const STACKED = { kind: "stacked" } as const;
