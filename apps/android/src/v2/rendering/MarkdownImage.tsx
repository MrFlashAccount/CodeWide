import { useState } from "react";
import { Image, Pressable, StyleSheet } from "react-native";

import { useEvent } from "../../react/useEvent";
import { colors, radii } from "../theme";
import { AsyncActionFeedbackView } from "../presentation/actions/AsyncActionFeedbackView";
import { useAsyncAction } from "../presentation/actions/useAsyncAction";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { classifyMarkdownLink } from "./linkClassification";
import { useResolvedMarkdownImages } from "./ResolvedImageGroup";
import { type MarkdownImageReference, useV2RenderingCapabilities } from "./renderingCapabilities";

interface MarkdownImageProps {
  references: MarkdownImageReference[];
  selectedId: string;
}

export function MarkdownImage(props: MarkdownImageProps): React.JSX.Element {
  const { references, selectedId } = props;
  const capabilities = useV2RenderingCapabilities();
  const items = useResolvedMarkdownImages();
  const selected = items.find((item) => item.id === selectedId);
  const fallback = references.find((item) => item.id === selectedId);
  const [localPreview, setLocalPreview] = useState(false);
  const action = useAsyncAction();
  const closeLocalPreview = useEvent(() => setLocalPreview(false));
  const open = useEvent(() => {
    if (selected === undefined) return;
    action.run({
      action: async () => {
        if (capabilities.openImagePreview === undefined) {
          setLocalPreview(true);
          return;
        }
        if (!(await capabilities.openImagePreview(items, selected.id))) setLocalPreview(true);
      },
      failure: "Could not open image preview.",
      pending: "Opening image…",
    });
  });
  const openPrivateImage = useEvent(() => {
    if (fallback === undefined) return;
    action.run({
      action: async () => {
        if ((await capabilities.openLocalDocument?.(fallback.reference)) === false) {
          throw new Error("The image could not be opened.");
        }
      },
      failure: "Could not open image.",
      pending: "Opening image…",
    });
  });
  if (selected === undefined) {
    const classification = classifyMarkdownLink(fallback?.reference ?? "");
    if (
      fallback !== undefined &&
      classification.kind === "remoteFile" &&
      capabilities.openLocalDocument !== undefined &&
      capabilities.canOpenLocalDocument?.(fallback.reference) !== false
    ) {
      return (
        <>
          <Pressable
            accessibilityLabel={`Open ${fallback.alt}`}
            accessibilityRole="imagebutton"
            accessibilityState={{ busy: action.pending, disabled: action.pending }}
            disabled={action.pending}
            onPress={openPrivateImage}
            style={styles.privateImage}
          >
            <Text numberOfLines={1} style={styles.link}>
              {fallback.alt}
            </Text>
          </Pressable>
          <AsyncActionFeedbackView
            error={action.error}
            onRetry={action.retry}
            pending={action.pending}
            pendingLabel={action.pendingLabel}
          />
        </>
      );
    }
    return (
      <Text selectable style={styles.secondary}>
        [Image: {fallback?.alt ?? "Image"}]
      </Text>
    );
  }
  return (
    <>
      <Pressable
        accessibilityLabel={`Open ${selected.alt}`}
        accessibilityRole="imagebutton"
        accessibilityState={{ busy: action.pending, disabled: action.pending }}
        disabled={action.pending}
        onPress={open}
      >
        <Image
          accessibilityLabel={selected.alt}
          resizeMode="contain"
          source={selected.source}
          style={styles.image}
        />
      </Pressable>
      <AsyncActionFeedbackView
        error={action.error}
        onRetry={action.retry}
        pending={action.pending}
        pendingLabel={action.pendingLabel}
      />
      <ImagePreviewModal
        initialId={selected.id}
        items={items}
        onClose={closeLocalPreview}
        visible={localPreview}
      />
    </>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.code, borderRadius: radii.medium, height: 220, width: "100%" },
  link: { color: colors.accent, textDecorationLine: "underline" },
  privateImage: { justifyContent: "center", minHeight: 44 },
  secondary: { color: colors.textMuted },
});
