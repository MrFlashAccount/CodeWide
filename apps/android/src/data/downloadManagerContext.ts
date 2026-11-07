import { createContext, useContext } from "react";

import type { DownloadManager } from "./downloadManager";

/** Carries the process download manager; `DownloadManagerProvider` supplies it. */
export const DownloadManagerContext = createContext<DownloadManager | null>(null);

export function useDownloadManager(): DownloadManager {
  const manager = useContext(DownloadManagerContext);
  if (manager === null) {
    throw new Error("useDownloadManager must be used inside DownloadManagerProvider");
  }
  return manager;
}
