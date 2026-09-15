import { useState } from "react";
import { useEvent } from "../../react/useEvent";

/** Workspace browser visibility is independent of the selected conversation. */
export function useBrowserNavigation() {
  const [loopbackBrowser, setLoopbackBrowser] = useState<{ title: string; url: string } | null>(
    null,
  );
  const openBrowser = useEvent((title: string, url: string) => setLoopbackBrowser({ title, url }));
  const closeBrowser = useEvent(() => setLoopbackBrowser(null));
  return { loopbackBrowser, openBrowser, closeBrowser };
}

import { nativePortForwardingStore } from "../../data/native-port-forwarding-store";
import { forwardedLoopbackUrl, type LoopbackLinkTarget } from "../../rendering/loopback-link";

/** Captured server qualification survives the asynchronous native-forward startup. */
export function useLoopbackNavigation(
  native: boolean,
  activeConnectionId: string,
  onOpenBrowser: (title: string, url: string) => void,
) {
  const openLoopbackLink = useEvent(async (target: LoopbackLinkTarget) => {
    const profile = await nativePortForwardingStore.ensureStarted({
      connectionId: activeConnectionId,
      remotePort: target.remotePort,
      label: `localhost:${target.remotePort}`,
    });
    onOpenBrowser(profile.label, forwardedLoopbackUrl(target, profile));
  });
  return native && activeConnectionId !== "" ? openLoopbackLink : undefined;
}
