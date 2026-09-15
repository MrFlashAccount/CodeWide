import type { TunnelValue } from "../../data/workspace-resource-database";
import type { LoopbackLinkTarget } from "../../rendering/loopback-link";
/** Qualified capabilities consumed by the ports owner in conversation composition. */
export type ConversationPortCapabilities = {
  tunnelResourceId: string | null;
  portForwardingConnectionId: string | null;
  portForwardingServerName: string;
  onOpenPortForward: ((title: string, url: string) => void) | undefined;
  onOpenLoopbackLink: ((target: LoopbackLinkTarget) => Promise<void>) | undefined;
  onCreateTunnel: ((port: number, ttlSeconds: number) => Promise<TunnelValue>) | undefined;
  onRevokeTunnel: ((tunnelId: string) => Promise<void>) | undefined;
};
