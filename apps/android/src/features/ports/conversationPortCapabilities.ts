import type { TunnelValue } from "../../data/workspace-resource-database";
import type { LoopbackLinkTarget } from "../../rendering/loopback-link";
/** Qualified capabilities consumed by the ports owner in conversation composition. */
export type ConversationPortCapabilities = {
  onCreateTunnel: ((port: number, ttlSeconds: number) => Promise<TunnelValue>) | undefined;
  onOpenLoopbackLink: ((target: LoopbackLinkTarget) => Promise<void>) | undefined;
  onOpenPortForward: ((title: string, url: string) => void) | undefined;
  onRevokeTunnel: ((tunnelId: string) => Promise<void>) | undefined;
  portForwardingConnectionId: string | null;
  portForwardingServerName: string;
  tunnelResourceId: string | null;
};
