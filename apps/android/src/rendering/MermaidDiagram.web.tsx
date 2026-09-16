import { useId } from "react";
import { Image, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "../ui/Typography";
import { useAsyncResource } from "./async-resource-store";
import { themedAsciiDiagramSvg } from "./ascii-diagram";
import type { ContentReviewTarget } from "./content-review";
import { NativeCodeBlock } from "./NativeCodeBlock";

const MAX_SOURCE_CHARS = 128 * 1024;
// Start fetching the renderer as soon as the Markdown surface is loaded, but
// keep Mermaid's diagram engines out of the main web bundle.
const mermaidModule = import("mermaid");
const svgbobModule = import("@codewide/rendering-core/ascii");

export function MermaidDiagram({
  diagramId: _diagramId,
  reveal: _reveal = false,
  reviewTarget: _reviewTarget,
  source,
}: {
  diagramId?: string;
  reveal?: boolean;
  reviewTarget?: ContentReviewTarget;
  source: string;
}) {
  const reactId = useId().replaceAll(/[^a-zA-Z0-9_-]/gu, "");
  const tooLarge = source.length > MAX_SOURCE_CHARS;
  const resource = useAsyncResource<{ aspectRatio: number; uri: string }>(
    tooLarge ? null : `mermaid-web:${source}`,
    source,
    async (_publish, signal) => {
      const { default: mermaid } = await mermaidModule;
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      mermaid.initialize({
        flowchart: { htmlLabels: false },
        securityLevel: "strict",
        startOnLoad: false,
        suppressErrorRendering: true,
        theme: "dark",
      });
      const result = await mermaid.render(`mermaid-${reactId}`, source);
      // WHY: The AbortSignal can change while Mermaid's asynchronous render is pending.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const viewBox = /viewBox=["']\s*([\d.-]+)\s+([\d.-]+)\s+([\d.]+)\s+([\d.]+)\s*["']/u.exec(
        result.svg,
      );
      const aspectRatio =
        viewBox === null
          ? 1.6
          : Math.max(0.35, Math.min(5, Number(viewBox[3]) / Number(viewBox[4])));
      return {
        aspectRatio,
        uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`,
      };
    },
    (value) => value.uri.length,
  );

  if (tooLarge) {
    return (
      <View style={styles.fallback}>
        <Text selectable style={styles.error}>
          Diagram is too large to preview safely
        </Text>
        <NativeCodeBlock language="text" value={source} />
      </View>
    );
  }
  const rendered = resource.value;
  if (resource.error !== null) {
    return (
      <View style={styles.fallback}>
        <Text selectable style={styles.error}>
          Could not render diagram · showing source
        </Text>
        <NativeCodeBlock language="text" value={source} />
      </View>
    );
  }
  if (rendered === null) {
    return (
      <View style={styles.loading}>
        <Text style={styles.secondary}>Rendering diagram…</Text>
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel="Mermaid diagram"
      resizeMode="contain"
      source={{ uri: rendered.uri }}
      style={[styles.image, { aspectRatio: rendered.aspectRatio }]}
    />
  );
}

export function AsciiDiagram({ source }: { source: string }) {
  const tooLarge = source.length > MAX_SOURCE_CHARS;
  const resource = useAsyncResource<{ aspectRatio: number; uri: string }>(
    tooLarge ? null : `ascii-diagram-web:${source}`,
    source,
    async (_publish, signal) => {
      const { renderSvgbob } = await svgbobModule;
      if (signal.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const svg = themedAsciiDiagramSvg(await renderSvgbob(source));
      const dimensions = /<svg[^>]*\bwidth=["']([\d.]+)["'][^>]*\bheight=["']([\d.]+)["']/u.exec(
        svg,
      );
      const aspectRatio =
        dimensions === null
          ? 1.6
          : Math.max(0.35, Math.min(5, Number(dimensions[1]) / Number(dimensions[2])));
      return { aspectRatio, uri: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
    },
    (value) => value.uri.length,
  );

  if (tooLarge) {
    return (
      <View style={styles.fallback}>
        <Text selectable style={styles.error}>
          Diagram is too large to preview safely
        </Text>
      </View>
    );
  }
  const rendered = resource.value;
  if (resource.error !== null) {
    return (
      <View style={styles.fallback}>
        <Text selectable style={styles.error}>
          {resource.error}
        </Text>
      </View>
    );
  }
  if (rendered === null) {
    return (
      <View style={styles.loading}>
        <Text style={styles.secondary}>Rendering diagram…</Text>
      </View>
    );
  }
  return (
    <Image
      accessibilityLabel="Diagram"
      resizeMode="contain"
      source={{ uri: rendered.uri }}
      style={[styles.image, { aspectRatio: rendered.aspectRatio }]}
    />
  );
}

const styles = StyleSheet.create({
  error: {
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  fallback: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    maxWidth: "100%",
    minWidth: 0,
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
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    justifyContent: "center",
    maxWidth: "100%",
    minHeight: 96,
    minWidth: 0,
    width: "100%",
  },
  secondary: {
    color: colors.textMuted,
    ...typeScale.label,
  },
});
