import { createContext, type ReactNode, useContext, useState } from "react";

import { markdownImageRevision } from "./richMarkdownModel";
import { ResolvedImageResource, type RenderingImageResolver } from "./resolvedImageResource";
import type { MarkdownImageReference } from "./renderingCapabilities";

interface ResolvedImageResourceCacheProviderProps {
  children: ReactNode;
}

/** Keeps image resolution stable while a rendering-capability scope is mounted. */
export class ResolvedImageResourceCache {
  readonly #resources = new Map<string, ResolvedImageResource>();

  resource(
    references: MarkdownImageReference[],
    sourceRevision: string,
    resolver: RenderingImageResolver | undefined,
  ): ResolvedImageResource {
    const key = resolvedImageResourceKey(references, sourceRevision);
    const current = this.#resources.get(key);
    if (current !== undefined) return current;
    const resource = new ResolvedImageResource(references, resolver);
    this.#resources.set(key, resource);
    return resource;
  }
}

const ResolvedImageResourceCacheContext = createContext<ResolvedImageResourceCache | null>(null);

export function ResolvedImageResourceCacheProvider(
  props: ResolvedImageResourceCacheProviderProps,
): React.JSX.Element {
  const { children } = props;
  const [cache] = useState(() => new ResolvedImageResourceCache());
  return (
    <ResolvedImageResourceCacheContext.Provider value={cache}>
      {children}
    </ResolvedImageResourceCacheContext.Provider>
  );
}

export function useResolvedImageResourceCache(): ResolvedImageResourceCache | null {
  return useContext(ResolvedImageResourceCacheContext);
}

export function resolvedImageResourceKey(
  references: MarkdownImageReference[],
  sourceRevision: string,
): string {
  return `${sourceRevision}\u0000${markdownImageRevision(references)}`;
}
