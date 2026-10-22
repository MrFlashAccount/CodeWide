/**
 * Legend-owned snapshot of one progressive forge/review resource. Already
 * published data stays visible while a refresh runs or after it fails.
 */
import type { ForgeFailure } from "./forgeErrors";

/** Progressive resource snapshot read during render. */
export type RemoteValue<Value> =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly value: Value | null }
  | { readonly refreshing: boolean; readonly status: "ready"; readonly value: Value }
  | { readonly failure: ForgeFailure; readonly status: "failed"; readonly value: Value | null };

/** The last published value of a snapshot, if any. */
export function remoteValue<Value>(state: RemoteValue<Value> | undefined): Value | null {
  if (state === undefined || state.status === "idle") {
    return null;
  }
  return state.value;
}

/** The snapshot published when a load starts: keep the previous value visible. */
export function loadingFrom<Value>(previous: RemoteValue<Value> | undefined): RemoteValue<Value> {
  const value = remoteValue(previous);
  return value === null
    ? { status: "loading", value: null }
    : { refreshing: true, status: "ready", value };
}
