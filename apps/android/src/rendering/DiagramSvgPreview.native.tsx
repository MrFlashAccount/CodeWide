import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "../ui/Typography";
import { useAppDialog } from "../ui/AppDialog";
import { useAsyncResource } from "./async-resource-store";
import {
  diagramPreviewKey,
  renderDiagramPreview,
  type DiagramPreviewEngine,
} from "./diagram-preview.native";
import type { DiagramPreviewResult } from "./diagram-preview-result";
import { InlineMediaFrame } from "./InlineMediaFrame";
import { checkAborted } from "../native/check-aborted";
import { DiagramPreviewVisibility } from "./DiagramPreviewViewport";

interface DiagramSvgPreviewProps {
  readonly engine: DiagramPreviewEngine;
  readonly onOpen: () => void;
  readonly onSettled: () => void;
  readonly source: string;
}

export function DiagramSvgPreview(props: DiagramSvgPreviewProps) {
  return (
    <DiagramPreviewVisibility>
      {(visibility) => <DiagramImagePreview {...props} {...visibility} />}
    </DiagramPreviewVisibility>
  );
}

function DiagramImagePreview({
  activated,
  engine,
  near,
  onOpen,
  onSettled,
  source,
}: DiagramSvgPreviewProps & { readonly activated: boolean; readonly near: boolean }) {
  const dialog = useAppDialog();
  const key = diagramPreviewKey(engine, source);
  const [copied, setCopied] = useState(false);
  const resource = useAsyncResource<DiagramPreviewResult>(
    activated ? key : null,
    0,
    async (_publish, signal) => {
      try {
        return await renderDiagramPreview(engine, source, signal);
      } catch (error) {
        checkAborted(signal);
        return {
          message: error instanceof Error ? error.message : "Diagram renderer failed",
          status: "error",
        };
      }
    },
    (value) => (value.status === "ready" ? value.preview.uri.length * 2 : value.message.length * 2),
  );
  const settled = useEvent(onSettled);
  useEffect(() => {
    if (resource.status === "ready" || resource.status === "error") {
      settled();
    }
  }, [resource.status, settled]);
  const result = resource.value;
  const preview = result?.status === "ready" ? result.preview : null;
  const error = result?.status === "error" ? result.message : null;
  if (error !== null) {
    return (
      <InlineMediaFrame>
        <View accessibilityRole="alert" style={[styles.preview, styles.errorPreview]}>
          <View style={styles.errorHeader}>
            <AppText style={styles.errorTitle}>Could not render diagram</AppText>
            <Pressable
              accessibilityLabel="Copy diagram error"
              accessibilityRole="button"
              onPress={() => {
                Clipboard.setStringAsync(error).then(
                  () => {
                    setCopied(true);
                  },
                  (error: unknown) => {
                    dialog.alert(
                      "Copy failed",
                      error instanceof Error ? error.message : "Could not copy diagram error",
                    );
                  },
                );
              }}
              style={styles.copyButton}
            >
              <Ionicons
                color={copied ? colors.green : colors.textMuted}
                name={copied ? "checkmark" : "copy-outline"}
                size={iconSize.inline}
              />
              <AppText style={styles.copyLabel}>{copied ? "Copied" : "Copy error"}</AppText>
            </Pressable>
          </View>
          <AppText numberOfLines={4} selectable style={styles.errorMessage}>
            {error}
          </AppText>
        </View>
      </InlineMediaFrame>
    );
  }
  return (
    <InlineMediaFrame>
      <Pressable
        accessibilityLabel="Open diagram fullscreen"
        accessibilityRole="button"
        onPress={onOpen}
        style={styles.preview}
      >
        {!near || preview === null ? (
          <View style={styles.placeholder}>
            <Ionicons color={colors.textMuted} name="git-network-outline" size={iconSize.inline} />
            <AppText style={styles.hint}>{near ? "Rendering diagram…" : "Diagram preview"}</AppText>
          </View>
        ) : (
          <Image resizeMode="contain" source={{ uri: preview.uri }} style={styles.image} />
        )}
      </Pressable>
    </InlineMediaFrame>
  );
}

const styles = StyleSheet.create({
  copyButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  copyLabel: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.medium,
  },
  errorHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  errorMessage: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  errorPreview: {
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: 120,
  },
  errorTitle: {
    color: colors.text,
    flex: 1,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  hint: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  image: {
    height: "100%",
    width: "100%",
  },
  placeholder: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
  },
  preview: {
    backgroundColor: colors.surfaceRaised,
    flex: 1,
    padding: spacing.xs,
    width: "100%",
  },
});
