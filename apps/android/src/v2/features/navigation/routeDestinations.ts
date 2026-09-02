import type { Href, UnknownInputParams } from "expo-router";

import type { SavedServerId } from "../../domain/ids";
import type { QualifiedThread } from "../../domain/qualifiedThread";

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

export interface AttachmentPreviewDestinationParams extends ThreadDestinationParams {
  attachmentId: string;
  mediaType: string;
  name: string;
  sourceUri: string;
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
  mediaType: string;
  name: string;
  owner: QualifiedThread;
  sourceUri: string;
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
      mediaType: input.mediaType,
      name: input.name,
      savedServerId: input.owner.savedServerId,
      sourceUri: input.sourceUri,
      threadId: input.owner.threadId,
    },
    pathname: "/servers/[savedServerId]/threads/[threadId]/attachments/[attachmentId]",
  } satisfies Href;
}

export function serverPathname(id: SavedServerId): string {
  return `/servers/${encodeURIComponent(id)}`;
}
