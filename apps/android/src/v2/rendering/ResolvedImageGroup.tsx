import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from "react";

import { ResolvedImageResource } from "./resolvedImageResource";
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
  const [resource] = useState(
    () => new ResolvedImageResource(references, capabilities.resolveImageSource),
  );
  const items = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  return <ResolvedImageContext.Provider value={items}>{children}</ResolvedImageContext.Provider>;
}

export function useResolvedMarkdownImages(): RenderingImageItem[] {
  return useContext(ResolvedImageContext);
}
