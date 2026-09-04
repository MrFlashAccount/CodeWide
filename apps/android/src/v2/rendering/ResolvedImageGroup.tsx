import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";

import { ResolvedImageResource, type RenderingImageResolver } from "./resolvedImageResource";
import {
  resolvedImageResourceKey,
  useResolvedImageResourceCache,
} from "./resolvedImageResourceCache";
import {
  type MarkdownImageReference,
  type RenderingImageItem,
  useV2RenderingCapabilities,
} from "./renderingCapabilities";

interface ResolvedImageGroupProps {
  children: ReactNode;
  references: MarkdownImageReference[];
}

const ResolvedImageContext = createContext<RenderingImageItem[]>([]);

/** Resolves a Markdown document's image gallery once, including private assets. */
export function ResolvedImageGroup(props: ResolvedImageGroupProps): React.JSX.Element {
  const { children, references } = props;
  const capabilities = useV2RenderingCapabilities();
  const cache = useResolvedImageResourceCache();
  const sourceRevision = capabilities.imageSourceRevision ?? "public";
  const resourceKey = resolvedImageResourceKey(references, sourceRevision);
  if (cache === null) {
    return (
      <LocalResolvedImageGroup
        key={resourceKey}
        references={references}
        resolver={capabilities.resolveImageSource}
      >
        {children}
      </LocalResolvedImageGroup>
    );
  }
  const resource = cache.resource(references, sourceRevision, capabilities.resolveImageSource);
  return <ResolvedImageGroupContent resource={resource}>{children}</ResolvedImageGroupContent>;
}

interface LocalResolvedImageGroupProps extends ResolvedImageGroupProps {
  resolver: RenderingImageResolver | undefined;
}

function LocalResolvedImageGroup(props: LocalResolvedImageGroupProps): React.JSX.Element {
  const { children, references, resolver } = props;
  const [resource] = useState(() => new ResolvedImageResource(references, resolver));
  return <ResolvedImageGroupContent resource={resource}>{children}</ResolvedImageGroupContent>;
}

interface ResolvedImageGroupContentProps {
  children: ReactNode;
  resource: ResolvedImageResource;
}

function ResolvedImageGroupContent(props: ResolvedImageGroupContentProps): React.JSX.Element {
  const { children, resource } = props;
  const items = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  return <ResolvedImageContext.Provider value={items}>{children}</ResolvedImageContext.Provider>;
}

export function useResolvedMarkdownImages(): RenderingImageItem[] {
  return useContext(ResolvedImageContext);
}
