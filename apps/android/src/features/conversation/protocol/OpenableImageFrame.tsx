import type { Dispatch, SetStateAction } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useImagePreview, useImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import { usePrivateImageUri } from "../../../rendering/use-private-image-uri";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./ImageProtocolBlock.styles";
import type { OpenableImageProps } from "./OpenableImage.types";

/** Decoded image/status display; preview registration and retry identity stay in OpenableImage. */
export function renderOpenableImageFrame({
  label,
  variant,
  privateImage,
  resolvedSource,
  previewItem,
  imageContainerStyle,
  setRetryRevision,
  openImagePreview,
  resolvedGroupId,
  onError,
}: {
  label: string;
  variant: "generated" | "user";
  privateImage: ReturnType<typeof usePrivateImageUri>;
  resolvedSource: ReturnType<typeof usePrivateImageUri>["source"];
  previewItem: Parameters<ReturnType<typeof useImagePreview>>[0];
  imageContainerStyle: StyleProp<ViewStyle>;
  setRetryRevision: Dispatch<SetStateAction<number>>;
  openImagePreview: ReturnType<typeof useImagePreview>;
  resolvedGroupId: ReturnType<typeof useImagePreviewGroup>;
  onError: OpenableImageProps["onError"];
}) {
  if (resolvedSource === null) {
    return (
      <View style={imageContainerStyle}>
        {privateImage.failed ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry ${label}`}
            onPress={() => setRetryRevision((current) => current + 1)}
          >
            <Text style={styles.menuNotice}>Image preview failed · Retry</Text>
          </Pressable>
        ) : (
          <ActivityIndicator color={colors.textMuted} />
        )}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${label}`}
      onPress={() =>
        openImagePreview({ ...previewItem, source: resolvedSource, groupId: resolvedGroupId })
      }
      style={imageContainerStyle}
    >
      <Image
        accessibilityLabel={label}
        source={resolvedSource}
        resizeMode={variant === "user" ? "cover" : "contain"}
        resizeMethod="resize"
        style={styles.openableImage}
        onError={() => {
          setRetryRevision((current) => current + 1);
          onError?.();
        }}
      />
      <View style={styles.imageOpenBadge}>
        <InlineIcon name="expand-outline" role="label" color="#ffffff" />
      </View>
    </Pressable>
  );
}
