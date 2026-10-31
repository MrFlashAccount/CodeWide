import { useContext, type ReactNode } from "react";

import { SurfaceToneProvider } from "../ui/surfaceTone";
import { ThreePanelsContext, type ThreePanelsContent } from "../ui/threePanels";
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
 * the frame's variant, the owner-declared chrome resolved against that variant, the pane's surface
 * tone and what the neighbouring pane of the same destination shows.
 */
export function ThreePanelsPane({
  capabilities,
  children,
  label,
  neighbour,
  pane,
}: {
  readonly capabilities: WorkspacePaneCapabilities;
  readonly children: ReactNode;
  /** What the pane holds, for its control labels. */
  readonly label: string;
  readonly neighbour: ThreePanelsContent | null;
  readonly pane: WorkspacePane;
}): React.JSX.Element {
  const variant = useContext(WorkspacePanesContext)?.visibility ?? STACKED;
  const chrome = useWorkspacePaneChrome({ capabilities, label, pane });
  const tone = PANE_TONE[pane];
  return (
    <ThreePanelsContext.Provider value={{ chrome, neighbour, pane, tone, variant }}>
      <SurfaceToneProvider value={tone}>{children}</SurfaceToneProvider>
    </ThreePanelsContext.Provider>
  );
}

const STACKED = { kind: "stacked" } as const;
