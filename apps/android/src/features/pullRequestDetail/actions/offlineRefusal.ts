import type { useAppDialog } from "../../../ui/AppDialog";

/**
 * The one explanation of a write refused locally while the companion is
 * offline: every PR write needs an acknowledged companion request, so nothing
 * is queued.
 */
export function alertOfflineWrite(dialog: ReturnType<typeof useAppDialog>): void {
  dialog.alert("The companion is offline", "Writes need an acknowledged companion request.");
}
