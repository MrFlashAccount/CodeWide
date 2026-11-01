/**
 * Routes content-free Companion forge/review invalidation notifications from the
 * ordered event projection to the resource owners that re-read their data.
 * The notifications carry only a scope; no forge content passes through here.
 */
import { pullRequestKey, type PullRequestKey } from "./forgeContract";
import { decodeOrNull, oneOf, record } from "./forgeWire";
import { diffSource, type DiffSource } from "./reviewContract";

const FORGE_INVALIDATED_METHOD = "companion/forge/invalidated";
const REVIEW_INVALIDATED_METHOD = "companion/review/invalidated";

/** One parsed invalidation for one connection. */
export type ForgeInvalidation =
  | { readonly scope: "accounts" }
  | { readonly scope: "list" }
  | { readonly pullRequest: PullRequestKey; readonly scope: "pullRequest" }
  /** Only the PR's agent scenario states changed; no forge read is stale. */
  | { readonly pullRequest: PullRequestKey; readonly scope: "scenarios" }
  | { readonly scope: "review"; readonly source: DiffSource };

type Listener = (connectionId: string, invalidation: ForgeInvalidation) => void;

const listeners = new Set<Listener>();

function parse(method: unknown, params: unknown): ForgeInvalidation | null {
  if (method === REVIEW_INVALIDATED_METHOD) {
    return decodeOrNull(() => ({
      scope: "review" as const,
      source: diffSource(record(params, "params").source, "source"),
    }));
  }
  if (method !== FORGE_INVALIDATED_METHOD) {
    return null;
  }
  return decodeOrNull((): ForgeInvalidation => {
    const value = record(params, "params");
    const scope = oneOf(value.scope, ["accounts", "list", "pullRequest", "scenarios"], "scope");
    return scope === "pullRequest" || scope === "scenarios"
      ? { pullRequest: pullRequestKey(value.pullRequest, "pullRequest"), scope }
      : { scope };
  });
}

/** Process-lifetime invalidation channel shared by the projection and forge resources. */
export const forgeInvalidationBus = {
  /**
   * Publishes one notification when it is a forge/review invalidation.
   * Returns `false` for other methods or malformed params.
   */
  publish(connectionId: string, method: unknown, params: unknown): boolean {
    const invalidation = parse(method, params);
    if (invalidation === null) {
      return false;
    }
    for (const listener of listeners) {
      listener(connectionId, invalidation);
    }
    return true;
  },
  /** Registers a resource owner; returns its unsubscribe function. */
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
