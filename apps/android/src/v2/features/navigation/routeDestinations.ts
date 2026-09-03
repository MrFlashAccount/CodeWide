import type { Href, UnknownInputParams } from "expo-router";

import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";

const TUNNEL_MODE = "tunnel";

export type ThreadResourceRoute = "agents" | "attachments" | "changes" | "terminal";

export interface RouteDestination<TPath extends string, TParams> {
  params: TParams;
  pathname: TPath;
}

export interface SavedServerDestinationParams extends UnknownInputParams {
  savedServerId: SavedServerId;
}

export interface ThreadDestinationParams extends SavedServerDestinationParams {
  threadId: string;
}

export interface AgentDestinationParams extends ThreadDestinationParams {
  agentThreadId: string;
}

export interface PortDestinationParams extends SavedServerDestinationParams {
  profileId: string;
}

export interface PortBrowserDestinationParams extends PortDestinationParams {
  expiresAt?: string;
  label?: string;
  mode?: "tunnel";
  port?: string;
  suffix?: string;
}

export interface PortTunnelBrowserDestinationParams extends PortBrowserDestinationParams {
  expiresAt: string;
  label: string;
  mode: "tunnel";
  port: string;
  profileId: string;
  suffix: string;
}

export interface PortTunnelBrowserDestinationInput {
  expiresAt: number;
  label: string;
  port: number;
  suffix: string;
  tunnelId: string;
}

export interface AttachmentPreviewDestinationParams extends ThreadDestinationParams {
  attachmentId: string;
}

export interface WorkspaceFilePreviewDestinationParams extends ThreadDestinationParams {
  path: string;
}

export interface ThreadChangeOutputDestinationParams extends ThreadDestinationParams {
  path: string;
  scope: ReviewRouteScope;
}

export interface ItemOutputDestinationParams extends ThreadDestinationParams {
  itemId: string;
  turnId: string;
}

interface PairingDestinationParams extends UnknownInputParams {
  pairingCode: string;
}

export type ReviewRouteScope = "branch" | "lastTurn" | "session" | "staged" | "unstaged";

export interface ReviewStartDestinationParams extends ThreadDestinationParams {
  mode: "start";
}

export interface ReviewChangesDestinationParams extends ThreadDestinationParams {
  mode: "changes";
  scope?: ReviewRouteScope;
}

export interface ReviewResponseDestinationParams extends ThreadDestinationParams {
  itemId: string;
  mode: "response";
  turnId: string;
}

export type ThreadResourceDestination =
  | RouteDestination<"/servers/[savedServerId]/threads/[threadId]/agents", ThreadDestinationParams>
  | RouteDestination<
      "/servers/[savedServerId]/threads/[threadId]/attachments",
      ThreadDestinationParams
    >
  | RouteDestination<"/servers/[savedServerId]/threads/[threadId]/changes", ThreadDestinationParams>
  | RouteDestination<
      "/servers/[savedServerId]/threads/[threadId]/terminal",
      ThreadDestinationParams
    >;

export interface AttachmentPreviewDestinationInput {
  attachmentId: string;
  owner: QualifiedThread;
}

export function workspaceFilePreviewDestination(
  owner: QualifiedThread,
  path: string,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/workspace-files/preview",
  WorkspaceFilePreviewDestinationParams
> {
  return {
    params: { path, savedServerId: owner.savedServerId, threadId: owner.threadId },
    pathname: "/servers/[savedServerId]/threads/[threadId]/workspace-files/preview",
  } satisfies Href;
}

export function threadChangeOutputDestination(
  owner: QualifiedThread,
  path: string,
  scope: ReviewRouteScope,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/changes/output",
  ThreadChangeOutputDestinationParams
> {
  return {
    params: { path, savedServerId: owner.savedServerId, scope, threadId: owner.threadId },
    pathname: "/servers/[savedServerId]/threads/[threadId]/changes/output",
  } satisfies Href;
}

export function serversDestination(): "/servers" {
  return "/servers";
}

export function settingsDestination(): "/settings" {
  return "/settings";
}

export function newSavedServerDestination(): "/settings/servers/new" {
  return "/settings/servers/new";
}

/** @legacyBridge Used only by the excluded external pairing deep-link route. */
export function pairingDestination(
  pairingCode: string,
): RouteDestination<"/settings/servers/new", PairingDestinationParams> {
  return {
    params: { pairingCode },
    pathname: "/settings/servers/new",
  } satisfies Href;
}

export function serverDestination(
  id: SavedServerId,
): RouteDestination<"/servers/[savedServerId]", SavedServerDestinationParams> {
  return {
    params: { savedServerId: id },
    pathname: "/servers/[savedServerId]",
  } satisfies Href;
}

export function threadDestination(
  owner: QualifiedThread,
): RouteDestination<"/servers/[savedServerId]/threads/[threadId]", ThreadDestinationParams> {
  return {
    params: { savedServerId: owner.savedServerId, threadId: owner.threadId },
    pathname: "/servers/[savedServerId]/threads/[threadId]",
  } satisfies Href;
}

export function agentDestination(
  owner: QualifiedThread,
  agentThreadId: string,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/agents/[agentThreadId]",
  AgentDestinationParams
> {
  return {
    params: {
      agentThreadId,
      savedServerId: owner.savedServerId,
      threadId: owner.threadId,
    },
    pathname: "/servers/[savedServerId]/threads/[threadId]/agents/[agentThreadId]",
  } satisfies Href;
}

export function portDestination(
  savedServerId: SavedServerId,
  profileId: string,
): RouteDestination<"/servers/[savedServerId]/ports/[profileId]", PortDestinationParams> {
  return {
    params: { profileId, savedServerId },
    pathname: "/servers/[savedServerId]/ports/[profileId]",
  } satisfies Href;
}

export function portBrowserDestination(
  savedServerId: SavedServerId,
  profileId: string,
): RouteDestination<
  "/servers/[savedServerId]/ports/browser/[profileId]",
  PortBrowserDestinationParams
> {
  return {
    params: { profileId, savedServerId },
    pathname: "/servers/[savedServerId]/ports/browser/[profileId]",
  } satisfies Href;
}

export function portTunnelBrowserDestination(
  savedServerId: SavedServerId,
  input: PortTunnelBrowserDestinationInput,
): RouteDestination<
  "/servers/[savedServerId]/ports/browser/[profileId]",
  PortTunnelBrowserDestinationParams
> {
  const params: PortTunnelBrowserDestinationParams = {
    expiresAt: String(input.expiresAt),
    label: input.label,
    mode: TUNNEL_MODE,
    port: String(input.port),
    profileId: input.tunnelId,
    savedServerId,
    suffix: input.suffix,
  };
  return {
    params,
    pathname: "/servers/[savedServerId]/ports/browser/[profileId]",
  } satisfies Href;
}

export function newThreadDestination(
  id: SavedServerId,
): RouteDestination<"/servers/[savedServerId]/new", SavedServerDestinationParams> {
  return {
    params: { savedServerId: id },
    pathname: "/servers/[savedServerId]/new",
  } satisfies Href;
}

export function portsDestination(
  id: SavedServerId,
): RouteDestination<"/servers/[savedServerId]/ports", SavedServerDestinationParams> {
  return {
    params: { savedServerId: id },
    pathname: "/servers/[savedServerId]/ports",
  } satisfies Href;
}

export function serverSettingsDestination(
  id: SavedServerId,
): RouteDestination<"/settings/servers/[savedServerId]", SavedServerDestinationParams> {
  return {
    params: { savedServerId: id },
    pathname: "/settings/servers/[savedServerId]",
  } satisfies Href;
}

export function accountSettingsDestination(
  id: SavedServerId,
): RouteDestination<"/settings/accounts/[savedServerId]", SavedServerDestinationParams> {
  return {
    params: { savedServerId: id },
    pathname: "/settings/accounts/[savedServerId]",
  } satisfies Href;
}

export function threadResourceDestination(
  owner: QualifiedThread,
  resource: ThreadResourceRoute,
): ThreadResourceDestination {
  const params = { savedServerId: owner.savedServerId, threadId: owner.threadId };
  switch (resource) {
    case "agents":
      return {
        params,
        pathname: "/servers/[savedServerId]/threads/[threadId]/agents",
      } satisfies Href;
    case "attachments":
      return {
        params,
        pathname: "/servers/[savedServerId]/threads/[threadId]/attachments",
      } satisfies Href;
    case "changes":
      return {
        params,
        pathname: "/servers/[savedServerId]/threads/[threadId]/changes",
      } satisfies Href;
    case "terminal":
      return {
        params,
        pathname: "/servers/[savedServerId]/threads/[threadId]/terminal",
      } satisfies Href;
    default:
      return resource;
  }
}

export function attachmentPreviewDestination(
  input: AttachmentPreviewDestinationInput,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]",
  AttachmentPreviewDestinationParams
> {
  return {
    params: {
      attachmentId: input.attachmentId,
      savedServerId: input.owner.savedServerId,
      threadId: input.owner.threadId,
    },
    pathname: "/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]",
  } satisfies Href;
}

export function itemOutputDestination(
  owner: QualifiedThread,
  turnId: string,
  itemId: string,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/items/[itemId]/output",
  ItemOutputDestinationParams
> {
  return {
    params: {
      itemId,
      savedServerId: owner.savedServerId,
      threadId: owner.threadId,
      turnId,
    },
    pathname: "/servers/[savedServerId]/threads/[threadId]/items/[itemId]/output",
  } satisfies Href;
}

export function reviewStartDestination(
  owner: QualifiedThread,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/review",
  ReviewStartDestinationParams
> {
  const params: ReviewStartDestinationParams = {
    mode: "start",
    savedServerId: owner.savedServerId,
    threadId: owner.threadId,
  };
  return {
    params,
    pathname: "/servers/[savedServerId]/threads/[threadId]/review",
  } satisfies Href;
}

export function reviewChangesDestination(
  owner: QualifiedThread,
  scope?: ReviewRouteScope,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/review",
  ReviewChangesDestinationParams
> {
  const baseParams: ReviewChangesDestinationParams = {
    mode: "changes",
    savedServerId: owner.savedServerId,
    threadId: owner.threadId,
  };
  if (scope !== undefined) baseParams.scope = scope;
  return {
    params: baseParams,
    pathname: "/servers/[savedServerId]/threads/[threadId]/review",
  } satisfies Href;
}

export function reviewResponseDestination(
  owner: QualifiedThread,
  turnId: string,
  itemId: string,
): RouteDestination<
  "/servers/[savedServerId]/threads/[threadId]/review",
  ReviewResponseDestinationParams
> {
  const params: ReviewResponseDestinationParams = {
    itemId,
    mode: "response",
    savedServerId: owner.savedServerId,
    threadId: owner.threadId,
    turnId,
  };
  return {
    params,
    pathname: "/servers/[savedServerId]/threads/[threadId]/review",
  } satisfies Href;
}
