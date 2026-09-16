import { parseThreadDeepLink } from "../../data/deep-link";
import { useDeepLinkListener } from "../../data/use-deep-link-listener";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";

/** Maps V1 process deep links to the public route-owned navigation intents. */
export function useV1WorkspaceDeepLinks(
  openPairingCode: (code: string) => void,
  selectThread: (selectionKey: string | null) => void,
): void {
  useDeepLinkListener((raw) => {
    if (raw === null) {
      return;
    }
    if (raw.startsWith("codewide://pair") || raw.startsWith("codexremote://pair")) {
      openPairingCode(raw);
      return;
    }
    const parsed = parseThreadDeepLink(raw);
    if (parsed === null) {
      return;
    }
    selectThread(threadSelectionKey({ id: parsed.threadId, serverId: parsed.connectionId }));
  });
}
