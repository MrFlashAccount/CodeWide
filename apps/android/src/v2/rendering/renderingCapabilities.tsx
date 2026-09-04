import { createContext, type ComponentType, type ReactNode, useContext } from "react";

import { ResolvedImageResourceCacheProvider } from "./resolvedImageResourceCache";

export interface RenderingImageSource {
  headers?: Record<string, string>;
  uri: string;
}

export interface MarkdownImageReference {
  alt: string;
  id: string;
  link?: string;
  reference: string;
}

export interface RenderingImageItem {
  alt: string;
  id: string;
  link?: string;
  order: number;
  reference: string;
  source: RenderingImageSource;
}

interface TextReviewAnchor {
  blockPath: string;
  end: number;
  kind: "text";
  quote: string;
  start: number;
  targetId: string;
}

interface DiagramReviewAnchor {
  diagramId: string;
  kind: "diagram";
  source: string;
  targetId: string;
  x: number;
  y: number;
}

export type ContentReviewAnchor = DiagramReviewAnchor | TextReviewAnchor;

export interface DiagramReviewPoint {
  diagramId: string;
  id: string;
  pending: boolean;
  targetId: string;
  x: number;
  y: number;
}

export interface DiagramReviewOverlayProps {
  bottomOffset: number;
  diagramId: string;
  targetId: string;
}

export interface DiagramReviewComposerProps {
  diagramId: string;
  targetId: string;
}

export interface DiagramReviewCapability {
  Comments: ComponentType<DiagramReviewOverlayProps>;
  Composer: ComponentType<DiagramReviewComposerProps>;
  points: readonly DiagramReviewPoint[];
}

export interface V2RenderingCapabilities {
  annotateImage?(item: RenderingImageItem): void | Promise<void>;
  canAnnotateImage?(item: RenderingImageItem): boolean;
  canOpenLocalDocument?(href: string): boolean;
  imageSourceRevision?: string;
  beginReview?(anchor: ContentReviewAnchor): void | Promise<void>;
  diagramReview?: DiagramReviewCapability;
  openExternalLink?(url: string): void | Promise<void>;
  openImagePreview?(items: RenderingImageItem[], selectedId: string): boolean | Promise<boolean>;
  openLocalDocument?(href: string): boolean | Promise<boolean>;
  openLoopbackLink?(url: string): void | Promise<void>;
  resolveImageSource?(
    reference: string,
  ): RenderingImageSource | null | Promise<RenderingImageSource | null>;
}

interface V2RenderingCapabilityProviderProps {
  capabilities: V2RenderingCapabilities;
  children: ReactNode;
}

const RenderingCapabilityContext = createContext<V2RenderingCapabilities>({});

/**
 * Injects app-owned navigation and authenticated asset capabilities into the
 * transport-neutral Markdown renderer. The renderer never opens a private or
 * loopback resource by itself.
 */
export function V2RenderingCapabilityProvider(
  props: V2RenderingCapabilityProviderProps,
): React.JSX.Element {
  const { capabilities, children } = props;
  return (
    <RenderingCapabilityContext.Provider value={capabilities}>
      <ResolvedImageResourceCacheProvider>{children}</ResolvedImageResourceCacheProvider>
    </RenderingCapabilityContext.Provider>
  );
}

export function useV2RenderingCapabilities(): V2RenderingCapabilities {
  return useContext(RenderingCapabilityContext);
}
