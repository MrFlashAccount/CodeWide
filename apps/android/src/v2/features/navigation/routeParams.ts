import { savedServerId, threadId, type SavedServerId, type ThreadId } from "../../domain/ids";
import { qualifiedThread, type QualifiedThread } from "../../domain/qualifiedThread";

export type RawRouteParam = string | string[] | undefined;

export interface SavedServerRouteParams {
  savedServerId?: RawRouteParam;
}

export interface ThreadRouteParams extends SavedServerRouteParams {
  threadId?: RawRouteParam;
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

export function qualifiedThreadRouteParams(params: ThreadRouteParams): QualifiedThread | null {
  const server = savedServerRouteParam(params.savedServerId);
  const thread = threadRouteParam(params.threadId);
  return server === null || thread === null ? null : qualifiedThread(server, thread);
}
