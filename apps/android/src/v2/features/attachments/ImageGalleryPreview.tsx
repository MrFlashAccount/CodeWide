import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";

import type { PreviewStreamSource } from "../../application/preview/previewTransport";
import { InteractiveImageView } from "../../presentation/preview/InteractiveImageView";
import { ProductText as Text } from "../../presentation/text/ProductText";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";

interface ImageGalleryPreviewProps {
  canGoNext: boolean;
  canGoPrevious: boolean;
  count: number;
  index: number;
  name: string;
  onClose(): void;
  onNext(): void;
  onPrevious(): void;
  onRetry(): void | Promise<void>;
  source: PreviewStreamSource;
}

export function ImageGalleryPreview(props: ImageGalleryPreviewProps): React.JSX.Element {
  const {
    canGoNext,
    canGoPrevious,
    count,
    index,
    name,
    onClose,
    onNext,
    onPrevious,
    onRetry,
    source,
  } = props;
  return (
    <View style={styles.root}>
      <InteractiveImageView
        accessibilityLabel={name}
        canGoNext={canGoNext}
        canGoPrevious={canGoPrevious}
        onClose={onClose}
        onNext={onNext}
        onPrevious={onPrevious}
        onRetry={onRetry}
        source={{
          uri: source.uri,
          ...(source.headers === null ? {} : { headers: source.headers }),
        }}
      />
      {count > 1 ? (
        <View pointerEvents="box-none" style={styles.navigation}>
          <GalleryButton
            enabled={canGoPrevious}
            icon="chevron-back"
            label="Previous image"
            onPress={onPrevious}
          />
          <View style={styles.counter}>
            <Text style={styles.counterText}>
              {index + 1} / {count}
            </Text>
          </View>
          <GalleryButton
            enabled={canGoNext}
            icon="chevron-forward"
            label="Next image"
            onPress={onNext}
          />
        </View>
      ) : null}
    </View>
  );
}

interface GalleryButtonProps {
  enabled: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress(): void;
}

function GalleryButton(props: GalleryButtonProps): React.JSX.Element {
  const { enabled, icon, label, onPress } = props;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={[styles.button, !enabled && styles.disabled]}
    >
      <Ionicons color={colors.text} name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  counter: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  counterText: { color: colors.text, ...typeScale.label },
  disabled: { opacity: 0.32 },
  navigation: {
    alignItems: "center",
    bottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
  },
  root: { backgroundColor: colors.background, flex: 1 },
});
