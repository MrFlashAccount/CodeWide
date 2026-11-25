import type { ReactNode } from "react";

import type { DownloadManager } from "./downloadManager";
import { DownloadManagerContext } from "./downloadManagerContext";

/** Makes the process download manager reachable from previews, menus and the Downloads sheet. */
export function DownloadManagerProvider({
  children,
  manager,
}: {
  readonly children: ReactNode;
  readonly manager: DownloadManager;
}): React.JSX.Element {
  return (
    <DownloadManagerContext.Provider value={manager}>{children}</DownloadManagerContext.Provider>
  );
}
