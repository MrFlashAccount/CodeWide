import { createContext, createElement, type ReactNode, useContext } from "react";

/** A credential-free URL that a content owner issues for one image reference. */
export type DirectImageGrant = {
  /** Epoch milliseconds after which `url` stops loading; `null` when it does not expire. */
  readonly expiresAtMs: number | null;
  /** Stable identity of the image bytes and their disk cache key; never the URL itself. */
  readonly identity: string;
  /** What the phone fetches, without any authorization header. */
  readonly url: string;
};

/**
 * Content-owned direct image access. A reference without a grant keeps the private image
 * path. A failed direct load falls back to that same private path once, after any renewal.
 * The owner, not the renderer, knows where grants come from and how to refresh them.
 */
export type DirectImageSources = {
  /** Owner scope of the cached bytes; removing the scope (a deleted connection) removes them. */
  readonly cacheScope: string;
  /** The grant for an image reference exactly as the content wrote it, if any. */
  readonly grant: (reference: string) => DirectImageGrant | null;
  /**
   * A fresh grant after `stale` failed or expired. The owner refreshes its data at most once
   * for a stale URL; `null` when no fresh grant exists.
   */
  readonly renew: (reference: string, stale: DirectImageGrant) => Promise<DirectImageGrant | null>;
};

const DirectImageSourcesContext = createContext<DirectImageSources | null>(null);

/** Lets images below resolve through `sources` before the private image path. */
export function DirectImageSourcesProvider({
  children,
  sources,
}: {
  readonly children: ReactNode;
  readonly sources: DirectImageSources | null;
}): React.JSX.Element {
  return createElement(DirectImageSourcesContext.Provider, { value: sources }, children);
}

/** The nearest direct image sources; `null` outside any owner, so the private path applies. */
export function useDirectImageSources(): DirectImageSources | null {
  return useContext(DirectImageSourcesContext);
}
