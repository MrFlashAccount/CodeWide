import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../react/useEvent";
import { InteractiveImageView } from "../presentation/preview/InteractiveImageView";
import { colors, radii, spacing, touchTarget } from "../theme";
import { AsyncActionFeedbackView } from "../presentation/actions/AsyncActionFeedbackView";
import { useAsyncAction } from "../presentation/actions/useAsyncAction";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { classifyMarkdownLink } from "./linkClassification";
import { useV2RenderingCapabilities, type RenderingImageItem } from "./renderingCapabilities";

interface ImagePreviewModalProps {
  initialId: string;
  items: RenderingImageItem[];
  onClose(): void;
  visible: boolean;
}

export function ImagePreviewModal(props: ImagePreviewModalProps): React.JSX.Element | null {
  const { initialId, items, onClose, visible } = props;
  const capabilities = useV2RenderingCapabilities();
  const insets = useSafeAreaInsets();
  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.id === initialId),
  );
  const [index, setIndex] = useState(initialIndex);
  const item = items[index];
  const action = useAsyncAction();
  const annotate = useEvent(() => {
    if (item === undefined) return;
    action.run({
      action: async () => capabilities.annotateImage?.(item),
      failure: "Could not annotate image.",
      pending: "Opening annotation…",
    });
  });
  const openReference = useEvent(() => {
    if (item === undefined) return;
    const target = imageExternalTarget(item);
    if (target === null) return;
    action.run({
      action: async () => capabilities.openExternalLink?.(target),
      failure: "Could not open image source.",
      pending: "Opening image source…",
    });
  });
  const previous = useEvent(() => setIndex((current) => Math.max(0, current - 1)));
  const next = useEvent(() => setIndex((current) => Math.min(items.length - 1, current + 1)));
  if (item === undefined) return null;
  return (
    <Modal animationType="none" onRequestClose={onClose} transparent={false} visible={visible}>
      <GestureHandlerRootView style={styles.fill}>
        <View style={[styles.preview, { paddingBottom: insets.bottom, paddingTop: insets.top }]}>
          <InteractiveImageView
            key={item.id}
            accessibilityLabel={`${item.alt} full screen`}
            canGoNext={index < items.length - 1}
            canGoPrevious={index > 0}
            onClose={onClose}
            onNext={next}
            onPrevious={previous}
            source={item.source}
          />
          <View style={[styles.topBar, { top: insets.top + spacing.xs }]}>
            <PreviewButton icon="close" label="Close image" onPress={onClose} />
            <Text style={styles.counter}>
              {index + 1} / {items.length}
            </Text>
            {capabilities.annotateImage === undefined ||
            capabilities.canAnnotateImage?.(item) === false ? null : (
              <PreviewButton
                disabled={action.pending}
                icon="brush-outline"
                label="Annotate image"
                onPress={annotate}
                pending={action.pending}
              />
            )}
            {imageExternalTarget(item) === null ||
            capabilities.openExternalLink === undefined ? null : (
              <PreviewButton
                disabled={action.pending}
                icon="open-outline"
                label="Open image source"
                onPress={openReference}
                pending={action.pending}
              />
            )}
          </View>
          <AsyncActionFeedbackView
            error={action.error}
            onRetry={action.retry}
            pending={action.pending}
            pendingLabel={action.pendingLabel}
            style={styles.feedback}
          />
          {items.length <= 1 ? null : (
            <View style={styles.navigation}>
              <PreviewButton
                disabled={index === 0}
                icon="chevron-back"
                label="Previous image"
                onPress={previous}
              />
              <PreviewButton
                disabled={index >= items.length - 1}
                icon="chevron-forward"
                label="Next image"
                onPress={next}
              />
            </View>
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function imageExternalTarget(item: RenderingImageItem): string | null {
  const value = item.link ?? item.reference;
  const classification = classifyMarkdownLink(value);
  return classification.kind === "external" ? classification.url : null;
}

interface PreviewButtonProps {
  disabled?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
  pending?: boolean;
}

function PreviewButton(props: PreviewButtonProps): React.JSX.Element {
  const { disabled = false, icon, label, onPress, pending = false } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: pending, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? styles.disabled : null]}
    >
      {pending ? (
        <Text style={styles.pendingButton}>•••</Text>
      ) : (
        <Ionicons color="#ffffff" name={icon} size={22} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,.68)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  counter: { color: "#ffffff", flex: 1, textAlign: "center" },
  disabled: { opacity: 0.36 },
  feedback: {
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
    top: spacing.xl + touchTarget,
  },
  fill: { flex: 1 },
  navigation: {
    bottom: spacing.lg,
    flexDirection: "row",
    justifyContent: "space-between",
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
  },
  preview: { backgroundColor: colors.background, flex: 1, justifyContent: "center" },
  pendingButton: { color: "#ffffff" },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    left: spacing.xs,
    position: "absolute",
    right: spacing.xs,
  },
});
