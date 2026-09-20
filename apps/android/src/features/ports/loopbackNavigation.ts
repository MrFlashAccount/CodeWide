import { nativePortForwardingStore } from "../../data/native-port-forwarding-store";
import { useEvent } from "../../react/useEvent";
import { forwardedLoopbackUrl, type LoopbackLinkTarget } from "../../rendering/loopback-link";

/** Starts the qualified forward before handing its browser destination to the injected owner. */
export function useLoopbackNavigation(
  native: boolean,
  activeConnectionId: string,
  openBrowser: (title: string, url: string) => void,
): ((target: LoopbackLinkTarget) => Promise<void>) | undefined {
  const openLoopbackLink = useEvent(async (target: LoopbackLinkTarget) => {
    const profile = await nativePortForwardingStore.ensureStarted({
      connectionId: activeConnectionId,
      label: `localhost:${String(target.remotePort)}`,
      remotePort: target.remotePort,
    });
    openBrowser(profile.label, forwardedLoopbackUrl(target, profile));
  });
  return native && activeConnectionId !== "" ? openLoopbackLink : undefined;
}
