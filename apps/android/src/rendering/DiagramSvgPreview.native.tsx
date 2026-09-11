import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "../ui/Typography";
import { useAsyncResource } from "./async-resource-store";
import { diagramPreviewKey, renderDiagramPreview } from "./diagram-preview.native";
import type { DiagramPreviewResult } from "./diagram-preview-result";
import { useRichContentWidth } from "./RichContentLayout";
import { checkAborted } from "./check-aborted";
import { DiagramPreviewVisibility } from "./DiagramPreviewViewport";

interface DiagramSvgPreviewProps {
  readonly source: string;
  readonly onOpen: () => void;
  readonly onSettled: () => void;
}

export function DiagramSvgPreview(props: DiagramSvgPreviewProps) {
  return (
    <DiagramPreviewVisibility>
      {(visibility) => <DiagramImagePreview {...props} {...visibility} />}
    </DiagramPreviewVisibility>
  );
}

function DiagramImagePreview({
  source,
  onOpen,
  onSettled,
  near,
  activated,
}: DiagramSvgPreviewProps & { readonly near: boolean; readonly activated: boolean }) {
  const availableWidth = useRichContentWidth();
  const key = diagramPreviewKey(source);
  const [copied, setCopied] = useState(false);
  const resource = useAsyncResource<DiagramPreviewResult>(
    activated ? key : null, 0,
    async (_publish, signal) => {
      try {
        return await renderDiagramPreview(source, signal);
      } catch (cause) {
        checkAborted(signal);
        return { status: "error", message: cause instanceof Error ? cause.message : "Diagram renderer failed" };
      }
    },
    (value) => value.status === "ready" ? value.preview.uri.length * 2 : value.message.length * 2,
  );
  const settled = useEvent(onSettled);
  useEffect(() => {
    if (resource.status === "ready" || resource.status === "error") settled();
  }, [resource.status, settled]);
  const result = resource.value;
  const preview = result?.status === "ready" ? result.preview : null;
  const error = result?.status === "error" ? result.message : null;
  const height = preview === null ? 120 : Math.max(120, Math.min(440,
    (availableWidth ?? preview.width) * preview.height / preview.width,
  ));
  if (error !== null) {
    return (
      <View accessibilityRole="alert" style={[styles.preview, styles.errorPreview]}>
        <View style={styles.errorHeader}>
          <AppText style={styles.errorTitle}>Could not render diagram</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy diagram error"
            onPress={() => {
              void Clipboard.setStringAsync(error);
              setCopied(true);
            }}
            style={styles.copyButton}
          >
            <Ionicons name={copied ? "checkmark" : "copy-outline"} size={iconSize.inline} color={copied ? colors.green : colors.textMuted} />
            <AppText style={styles.copyLabel}>{copied ? "Copied" : "Copy error"}</AppText>
          </Pressable>
        </View>
        <AppText selectable numberOfLines={4} style={styles.errorMessage}>{error}</AppText>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Open diagram fullscreen" onPress={onOpen} style={[styles.preview, { height }]}>
      {!near || preview === null ? (
        <View style={styles.placeholder}>
          <Ionicons name="git-network-outline" size={iconSize.inline} color={colors.textMuted} />
          <AppText style={styles.hint}>{near ? "Rendering diagram…" : "Diagram preview"}</AppText>
        </View>
      ) : <Image source={{ uri: preview.uri }} resizeMode="contain" style={styles.image} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  preview: { width: "100%", padding: spacing.xs, backgroundColor: colors.surfaceRaised },
  placeholder: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  image: { width: "100%", height: "100%" },
  hint: { color: colors.textMuted, ...typeScale.label },
  errorPreview: { minHeight: 120, gap: spacing.xs, justifyContent: "center" },
  errorHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  errorTitle: { flex: 1, color: colors.text, ...typeScale.label, fontWeight: typeWeight.semibold },
  errorMessage: { color: colors.textMuted, ...typeScale.caption },
  copyButton: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radii.medium, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  copyLabel: { color: colors.textMuted, ...typeScale.caption, fontWeight: typeWeight.medium },
});
