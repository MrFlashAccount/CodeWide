import type { V1ThreadRouteParams } from "../../services/threads/threadRouteParams";
import { nativePortForwardingStore } from "../../data/native-port-forwarding-store";
import { useEvent } from "../../react/useEvent";
import { forwardedLoopbackUrl, type LoopbackLinkTarget } from "../../rendering/loopback-link";

/** Starts the qualified forward before handing its browser destination to the injected owner. */
export function useLoopbackNavigation(
  native: boolean,
  activeConnectionId: string,
  browser: {
    readonly openBrowser: (title: string, url: string) => void;
    readonly openBrowserInThread?: (
      title: string,
      url: string,
      thread: V1ThreadRouteParams | null,
    ) => void;
    readonly thread: V1ThreadRouteParams | null;
  },
): ((target: LoopbackLinkTarget) => Promise<void>) | undefined {
  const openLoopbackLink = useEvent(async (target: LoopbackLinkTarget) => {
    const profile = await nativePortForwardingStore.ensureStarted({
      connectionId: activeConnectionId,
      label: `localhost:${String(target.remotePort)}`,
      remotePort: target.remotePort,
    });
    const url = forwardedLoopbackUrl(target, profile);
    if (browser.openBrowserInThread === undefined) {
      browser.openBrowser(profile.label, url);
    } else {
      browser.openBrowserInThread(profile.label, url, browser.thread);
    }
  });
  return native && activeConnectionId !== "" ? openLoopbackLink : undefined;
}
