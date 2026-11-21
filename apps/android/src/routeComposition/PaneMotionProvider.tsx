import type { ReactNode } from "react";

import { useConstant } from "../react/useConstant";
import { createPaneMotion, PaneMotionContext } from "./paneMotion";

/** Owns one pane frame's rearrangement window for every pane rendered inside it. */
export function PaneMotionProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const motion = useConstant(createPaneMotion);
  return <PaneMotionContext.Provider value={motion}>{children}</PaneMotionContext.Provider>;
}
