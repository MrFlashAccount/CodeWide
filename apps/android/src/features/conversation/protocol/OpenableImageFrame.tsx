import type { Dispatch, SetStateAction } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { useImagePreview, useImagePreviewGroup } from "../../../rendering/ImagePreviewHost";
import type { usePrivateImageUri } from "../../../rendering/use-private-image-uri";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { styles } from "./ImageProtocolBlock.styles";
import type { OpenableImageProps } from "./OpenableImage.types";

/** Decoded image/status display; preview registration and retry identity stay in OpenableImage. */
export function renderOpenableImageFrame({
  imageContainerStyle,
  label,
  onError,
  openImagePreview,
  previewItem,
  privateImage,
  resolvedGroupId,
  resolvedSource,
  setRetryRevision,
  variant,
}: {
  imageContainerStyle: StyleProp<ViewStyle>;
  label: string;
  onError: OpenableImageProps["onError"];
  openImagePreview: ReturnType<typeof useImagePreview>;
  previewItem: Parameters<ReturnType<typeof useImagePreview>>[0];
  privateImage: ReturnType<typeof usePrivateImageUri>;
  resolvedGroupId: ReturnType<typeof useImagePreviewGroup>;
  resolvedSource: ReturnType<typeof usePrivateImageUri>["source"];
  setRetryRevision: Dispatch<SetStateAction<number>>;
  variant: "generated" | "user";
}) {
  if (resolvedSource === null) {
    return (
      <View style={imageContainerStyle}>
        {privateImage.failed ? (
          <Pressable
            accessibilityLabel={`Retry ${label}`}
            accessibilityRole="button"
            onPress={() => {
              setRetryRevision((current) => current + 1);
            }}
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
      accessibilityLabel={`Open ${label}`}
      accessibilityRole="button"
      onPress={() => {
        openImagePreview({ ...previewItem, groupId: resolvedGroupId, source: resolvedSource });
      }}
      style={imageContainerStyle}
    >
      <Image
        accessibilityLabel={label}
        onError={() => {
          setRetryRevision((current) => current + 1);
          onError?.();
        }}
        resizeMethod="resize"
        resizeMode={variant === "user" ? "cover" : "contain"}
        source={resolvedSource}
        style={styles.openableImage}
      />
      <View style={styles.imageOpenBadge}>
        <InlineIcon color="#ffffff" name="expand-outline" role="label" />
      </View>
    </Pressable>
  );
}
