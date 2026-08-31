import { savedServerId, threadId, type SavedServerId, type ThreadId } from "../../domain/ids";

export function requireSavedServerRouteParam(value: string | string[] | undefined): SavedServerId {
  if (typeof value !== "string") {
    throw new Error("SavedServerId route parameter is required");
  }
  return savedServerId(value);
}

export function requireThreadRouteParam(value: string | string[] | undefined): ThreadId {
  if (typeof value !== "string") {
    throw new Error("ThreadId route parameter is required");
  }
  return threadId(value);
}

export function requireOpaqueRouteParam(
  value: string | string[] | undefined,
  label: string,
): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 256) {
    throw new Error(`${label} route parameter is required`);
  }
  return value;
}
