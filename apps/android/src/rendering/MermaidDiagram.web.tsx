import { useId } from "react";
import { Image, StyleSheet, View } from "react-native";

import { colors, radii } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { useAsyncResource } from "./async-resource-store";

const MAX_SOURCE_CHARS = 128 * 1024;
// Start fetching the renderer as soon as the Markdown surface is loaded, but
// keep Mermaid's diagram engines out of the main web bundle.
const mermaidModule = import("mermaid");

export function MermaidDiagram({ source }: { source: string }) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const tooLarge = source.length > MAX_SOURCE_CHARS;
  const resource = useAsyncResource<{ uri: string; aspectRatio: number }>(
    tooLarge ? null : `mermaid-web:${source}`,
    source,
    async (_publish, signal) => {
      const { default: mermaid } = await mermaidModule;
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "dark", flowchart: { htmlLabels: false } });
      const result = await mermaid.render(`mermaid-${reactId}`, source);
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const viewBox = /viewBox=["']\s*([\d.-]+)\s+([\d.-]+)\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(result.svg);
      const aspectRatio = viewBox === null ? 1.6 : Math.max(0.35, Math.min(5, Number(viewBox[3]) / Number(viewBox[4])));
      return { uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`, aspectRatio };
    },
    (value) => value.uri.length,
  );

  if (tooLarge) return <View style={styles.fallback}><Text selectable style={styles.error}>Diagram is too large to preview safely</Text></View>;
  const rendered = resource.value;
  if (resource.error !== null) return <View style={styles.fallback}><Text selectable style={styles.error}>{resource.error}</Text></View>;
  if (rendered === null) return <View style={styles.loading}><Text style={styles.secondary}>Rendering diagram…</Text></View>;
  return <Image accessibilityLabel="Mermaid diagram" resizeMode="contain" source={{ uri: rendered.uri }} style={[styles.image, { aspectRatio: rendered.aspectRatio }]} />;
}

const styles = StyleSheet.create({
  image: { width: "100%", maxHeight: 440, borderRadius: radii.medium, backgroundColor: colors.surfaceRaised },
  loading: { width: "100%", minHeight: 96, alignItems: "center", justifyContent: "center", borderRadius: radii.medium, backgroundColor: colors.surfaceRaised },
  fallback: { width: "100%", borderRadius: radii.medium, backgroundColor: colors.surfaceRaised, padding: 8 },
  secondary: { color: colors.textMuted, fontSize: 11 },
  error: { color: colors.textMuted, fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
});
