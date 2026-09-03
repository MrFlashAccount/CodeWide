import { useId, useState, useSyncExternalStore } from "react";
import { Image, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { MAX_DIAGRAM_SOURCE_CHARS } from "./diagramModel";
import { NativeCodeBlock } from "./NativeCodeBlock";

interface DiagramProps {
  diagramId?: string;
  reviewTargetId?: string;
  source: string;
}

interface RenderedDiagram {
  aspectRatio: number;
  uri: string;
}

interface RenderedDiagramSnapshot {
  error: string | null;
  rendered: RenderedDiagram | null;
}

interface DiagramImageProps {
  label: string;
  rendered: RenderedDiagram;
}

interface DiagramFallbackProps {
  error?: string;
  source: string;
}

interface DiagramResultProps extends DiagramFallbackProps {
  label: string;
  snapshot: RenderedDiagramSnapshot;
}

const mermaidModule = import("mermaid");
const svgbobModule = import("svgbob-wasm");

export function MermaidDiagram(props: DiagramProps): React.JSX.Element {
  const { source } = props;
  if (source.length > MAX_DIAGRAM_SOURCE_CHARS) return <DiagramFallback source={source} />;
  return <RenderedMermaidDiagram source={source} />;
}

export function AsciiDiagram(props: DiagramProps): React.JSX.Element {
  const { source } = props;
  if (source.length > MAX_DIAGRAM_SOURCE_CHARS) return <DiagramFallback source={source} />;
  return <RenderedAsciiDiagram source={source} />;
}

function RenderedAsciiDiagram(props: DiagramFallbackProps): React.JSX.Element {
  const { source } = props;
  const snapshot = useRenderedDiagram(() => renderAscii(source));
  return <DiagramResult label="Diagram" snapshot={snapshot} source={source} />;
}

function RenderedMermaidDiagram(props: DiagramFallbackProps): React.JSX.Element {
  const { source } = props;
  const renderId = useId().replaceAll(/[^a-zA-Z0-9_-]/gu, "");
  const snapshot = useRenderedDiagram(() => renderMermaid(source, renderId));
  return <DiagramResult label="Mermaid diagram" snapshot={snapshot} source={source} />;
}

function DiagramResult(props: DiagramResultProps): React.JSX.Element {
  const { label, snapshot, source } = props;
  if (snapshot.error !== null) return <DiagramFallback error={snapshot.error} source={source} />;
  if (snapshot.rendered === null) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.loading}>
        <Text style={styles.secondary}>Rendering diagram…</Text>
      </View>
    );
  }
  return <DiagramImage label={label} rendered={snapshot.rendered} />;
}

function DiagramImage(props: DiagramImageProps): React.JSX.Element {
  const { label, rendered } = props;
  return (
    <Image
      accessibilityLabel={label}
      resizeMode="contain"
      source={{ uri: rendered.uri }}
      style={[styles.image, { aspectRatio: rendered.aspectRatio }]}
    />
  );
}

function DiagramFallback(props: DiagramFallbackProps): React.JSX.Element {
  const { error, source } = props;
  return (
    <View style={styles.fallback}>
      <Text style={styles.secondary}>{error ?? "Diagram is too large to preview safely"}</Text>
      <NativeCodeBlock language="text" value={source} />
    </View>
  );
}

function useRenderedDiagram(load: () => Promise<RenderedDiagram>): RenderedDiagramSnapshot {
  const [resource] = useState(() => new RenderedDiagramResource(load));
  return useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
}

async function renderMermaid(source: string, renderId: string): Promise<RenderedDiagram> {
  const { default: mermaid } = await mermaidModule;
  mermaid.initialize({
    flowchart: { htmlLabels: false },
    securityLevel: "strict",
    startOnLoad: false,
    suppressErrorRendering: true,
    theme: "dark",
  });
  const result = await mermaid.render(`v2-mermaid-${renderId}`, source);
  return svgDiagram(result.svg);
}

async function renderAscii(source: string): Promise<RenderedDiagram> {
  const { render } = await svgbobModule;
  const svg = render(source).replace("</style>", `${ASCII_THEME}</style>`);
  return svgDiagram(svg);
}

function svgDiagram(svg: string): RenderedDiagram {
  const viewBox = /viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(svg);
  const width = Number(viewBox?.[1] ?? 1.6);
  const height = Number(viewBox?.[2] ?? 1);
  return {
    aspectRatio: Math.max(0.35, Math.min(5, width / height)),
    uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  };
}

class RenderedDiagramResource {
  readonly #listeners = new Set<() => void>();
  #snapshot: RenderedDiagramSnapshot = { error: null, rendered: null };

  constructor(load: () => Promise<RenderedDiagram>) {
    void load()
      .then((rendered) => this.#publish({ error: null, rendered }))
      .catch((cause: unknown) =>
        this.#publish({ error: diagramErrorMessage(cause), rendered: null }),
      );
  }

  snapshot = (): RenderedDiagramSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #publish(snapshot: RenderedDiagramSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

function diagramErrorMessage(cause: unknown): string {
  const detail = cause instanceof Error && cause.message !== "" ? `: ${cause.message}` : "";
  return `Could not render diagram${detail}`;
}

const ASCII_THEME =
  ".svgbob{background:transparent}.svgbob line,.svgbob path,.svgbob circle,.svgbob rect,.svgbob polygon{stroke:#9aa7b4}.svgbob text{fill:#eef2f6}.svgbob rect.backdrop{fill:transparent;stroke:none}";

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    gap: spacing.xs,
    padding: spacing.xs,
    width: "100%",
  },
  image: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    maxHeight: 440,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  loading: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: 96,
    width: "100%",
  },
  secondary: { color: colors.textMuted },
});
