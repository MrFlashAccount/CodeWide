/**
 * View snapshot of one progressive forge/review query. Already
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
