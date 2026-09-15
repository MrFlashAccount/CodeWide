import { useDeepLinkListener } from "../../data/use-deep-link-listener";
import { parseThreadDeepLink } from "../../data/deep-link";
import type { SelectWorkspaceThread } from "./threadNavigation";
import { threadSelectionKey } from "./threadSelection";

/** Pairing and thread deep links enter their existing public navigation intents. */
export function useWorkspaceDeepLinks(
  openPairingCode: (code: string) => void,
  setActiveThreadId: SelectWorkspaceThread,
) {
  useDeepLinkListener((raw) => {
    if (raw === null) return;
    if (raw.startsWith("codewide://pair") || raw.startsWith("codexremote://pair")) {
      openPairingCode(raw);
      return;
    }
    const parsed = parseThreadDeepLink(raw);
    if (parsed !== null) {
      setActiveThreadId(
        threadSelectionKey({ serverId: parsed.connectionId, id: parsed.threadId }),
        undefined,
        parsed.connectionId,
      );
    }
  });
}
