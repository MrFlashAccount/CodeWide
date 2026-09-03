import { savedServerId, threadId, type SavedServerId, type ThreadId } from "../../domain/ids";
import { qualifiedThread, type QualifiedThread } from "../../domain/qualifiedThread";

export type RawRouteParam = string | string[] | undefined;

interface SavedServerRouteParams {
  savedServerId?: RawRouteParam;
}

export interface ThreadRouteParams extends SavedServerRouteParams {
  threadId?: RawRouteParam;
}

interface ThreadDeepLinkRouteParams extends ThreadRouteParams {
  connectionId?: RawRouteParam;
}

interface PairDeepLinkRouteParams {
  e?: RawRouteParam;
  i?: RawRouteParam;
  n?: RawRouteParam;
  p?: RawRouteParam;
  t?: RawRouteParam;
  v?: RawRouteParam;
  x?: RawRouteParam;
  y?: RawRouteParam;
}

export function savedServerRouteParam(value: RawRouteParam): SavedServerId | null {
  if (typeof value !== "string") return null;
  try {
    return savedServerId(value);
  } catch {
    return null;
  }
}

export function threadRouteParam(value: RawRouteParam): ThreadId | null {
  if (typeof value !== "string") return null;
  try {
    return threadId(value);
  } catch {
    return null;
  }
}

export function opaqueRouteParam(value: RawRouteParam): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) return null;
  return value;
}

export function workspacePathRouteParam(value: RawRouteParam): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096 || value.includes("\0"))
    return null;
  return value;
}

export function pairingCodeRouteParam(value: RawRouteParam): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 4096) return null;
  return value;
}

export function qualifiedThreadRouteParams(params: ThreadRouteParams): QualifiedThread | null {
  const server = savedServerRouteParam(params.savedServerId);
  const thread = threadRouteParam(params.threadId);
  return server === null || thread === null ? null : qualifiedThread(server, thread);
}

/**
 * Accepts the old connectionId query alias only at the external deep-link boundary.
 * @legacyBridge Used only by the excluded external thread deep-link route.
 */
export function qualifiedThreadDeepLinkRouteParams(
  params: ThreadDeepLinkRouteParams,
): QualifiedThread | null {
  const canonical = externalSavedServerRouteParam(params.savedServerId);
  const legacy = externalSavedServerRouteParam(params.connectionId);
  const thread = externalThreadRouteParam(params.threadId);
  if (params.savedServerId !== undefined && canonical === null) return null;
  if (params.connectionId !== undefined && legacy === null) return null;
  if (canonical !== null && legacy !== null && canonical !== legacy) return null;
  const server = canonical ?? legacy;
  return server === null || thread === null ? null : qualifiedThread(server, thread);
}

/**
 * Reconstructs the payload carried by Expo Router without interpreting pairing authority.
 * @legacyBridge Used only by the excluded external pairing deep-link route.
 */
export function pairingDeepLinkRouteParam(params: PairDeepLinkRouteParams): string | null {
  const version = scalarRouteParam(params.v);
  const endpoint = scalarRouteParam(params.e);
  const token = scalarRouteParam(params.t);
  const expiresAt = scalarRouteParam(params.x);
  const name = scalarRouteParam(params.n);
  const emoji = scalarRouteParam(params.i);
  const pin = scalarRouteParam(params.p);
  if (
    version === null ||
    endpoint === null ||
    token === null ||
    expiresAt === null ||
    name === null ||
    emoji === null ||
    pin === null ||
    Array.isArray(params.y)
  ) {
    return null;
  }
  const url = new URL("codewide://pair");
  url.searchParams.set("v", version);
  url.searchParams.set("e", endpoint);
  url.searchParams.set("t", token);
  url.searchParams.set("x", expiresAt);
  url.searchParams.set("n", name);
  url.searchParams.set("i", emoji);
  url.searchParams.set("p", pin);
  if (params.y !== undefined) url.searchParams.set("y", params.y);
  const pairingCode = url.toString();
  return pairingCode.length <= 4096 ? pairingCode : null;
}

function scalarRouteParam(value: RawRouteParam): string | null {
  return typeof value === "string" ? value : null;
}

function externalSavedServerRouteParam(value: RawRouteParam): SavedServerId | null {
  return typeof value === "string" && !value.includes("\0") ? savedServerRouteParam(value) : null;
}

function externalThreadRouteParam(value: RawRouteParam): ThreadId | null {
  return typeof value === "string" && !value.includes("\0") ? threadRouteParam(value) : null;
}
