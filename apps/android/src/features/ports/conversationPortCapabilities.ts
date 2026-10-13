import type { LoopbackLinkTarget } from "../../rendering/loopback-link";
/** Qualified capabilities consumed by the ports owner in conversation composition. */
export type ConversationPortCapabilities = {
  onOpenBrowser:
    | ((title: string, url: string, headers?: Readonly<Record<string, string>>) => void)
    | undefined;
  onOpenLoopbackLink: ((target: LoopbackLinkTarget) => Promise<void>) | undefined;
  portForwardingConnectionId: string | null;
  portForwardingServerName: string;
};
