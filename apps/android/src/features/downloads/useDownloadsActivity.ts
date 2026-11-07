import { useSelector } from "@legendapp/state/react";

import { useDownloadManager } from "../../data/downloadManagerContext";
import { downloadsActivity, type DownloadsActivity } from "../../data/downloadManager";

/** Overall progress of running downloads, for an indicator outside the Downloads sheet. */
export function useDownloadsActivity(): DownloadsActivity {
  const manager = useDownloadManager();
  return useSelector(() => downloadsActivity(manager.entries$.get()));
}
