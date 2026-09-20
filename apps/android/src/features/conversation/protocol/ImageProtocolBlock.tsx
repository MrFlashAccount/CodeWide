import type {
  ImageProtocolBlockInput,
  ImageProtocolContentInput,
  ScopedPrivateAssetImageInput,
  ScopedRemoteImageInput,
} from "./ImageProtocolBlock.inputs";
import type { OpenableImageProps } from "./OpenableImage.types";
import { renderOpenableImageFrame } from "./OpenableImageFrame";
/** V1 ImageProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import { useContext, useId, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { ArtifactImageReferences } from "../../../rendering/ArtifactImageReferences";
import { basename } from "../../../rendering/changed-file-path";
import { useDocumentDownload } from "../../../rendering/DocumentPreviewHost";
import { privateImageAssetProjection, safeImageUri } from "../../../rendering/image-source";
import {
  useImagePreview,
  useImagePreviewGroup,
  useRegisterImagePreviewItem,
} from "../../../rendering/ImagePreviewHost";
import { RichMarkdown } from "../../../rendering/RichMarkdown";
import { usePrivateAssetUri, usePrivateImageUri } from "../../../rendering/use-private-image-uri";
import { colors } from "../../../theme";
import { AppText as Text } from "../../../ui/Typography";
import { Card } from "../turns/Card";
import { styles } from "./ImageProtocolBlock.styles";
import { protocolCopyText } from "./protocolCopyText";

export function OpenableImage({
  containerStyle,
  detail,
  download,
  groupId,
  label,
  link,
  onError,
  order,
  previewId,
  reference,
  source,
  variant = "generated",
}: OpenableImageProps) {
  const openImagePreview = useImagePreview();
  const inheritedGroupId = useImagePreviewGroup();
  const generatedId = useId();
  const [retryRevision, setRetryRevision] = useState(0);
  const resolvedGroupId = resolveImageGroupId(groupId, inheritedGroupId);
  const resolvedPreviewId = resolveImagePreviewId(previewId, generatedId);
  // Native Image does not reliably preserve Authorization headers. Decode a
  // private file URI after the scoped response has been downloaded by JS.
  const privateImage = usePrivateImageUri(source.uri, source.headers, retryRevision);
  const resolvedSource = privateImage.source;
  const resolvedDetail = resolveImageDetail(detail, privateImage.detail);
  const previewItem = {
    detail: resolvedDetail,
    id: resolvedPreviewId,
    label,
    reference: reference ?? source.uri,
    source: resolvedSource ?? source,
    ...(link === undefined ? {} : { link }),
    ...(download === undefined ? {} : { download }),
    ...(order === undefined ? {} : { order }),
  };
  useRegisterImagePreviewItem(resolvedGroupId, previewItem);
  const imageContainerStyle = resolveImageContainerStyle(
    containerStyle,
    defaultImageContainerStyle(variant),
  );
  return renderOpenableImageFrame({
    imageContainerStyle,
    label,
    onError,
    openImagePreview,
    previewItem,
    privateImage,
    resolvedGroupId,
    resolvedSource,
    setRetryRevision,
  });
}

function resolveImageGroupId(
  explicit: OpenableImageProps["groupId"],
  inherited: ReturnType<typeof useImagePreviewGroup>,
): ReturnType<typeof useImagePreviewGroup> {
  return explicit === undefined ? inherited : explicit;
}

function resolveImagePreviewId(explicit: string | undefined, generated: string): string {
  return explicit ?? generated;
}

function resolveImageContainerStyle(
  explicit: OpenableImageProps["containerStyle"],
  fallback: OpenableImageProps["containerStyle"],
): OpenableImageProps["containerStyle"] {
  return [explicit ?? fallback];
}

function defaultImageContainerStyle(
  variant: NonNullable<OpenableImageProps["variant"]>,
): OpenableImageProps["containerStyle"] {
  return variant === "user" ? styles.userImage : styles.generatedImage;
}

function resolveImageDetail(
  explicit: OpenableImageProps["detail"],
  discovered: ReturnType<typeof usePrivateImageUri>["detail"],
): ReturnType<typeof usePrivateImageUri>["detail"] {
  return explicit === undefined ? discovered : explicit;
}

export function ImageProtocolBlock(props: ImageProtocolBlockInput) {
  return (
    <Card
      icon="image-outline"
      title={props.block.title}
      {...(props.block.status === null ? {} : { status: props.block.status })}
      collapsible
      copyText={() => protocolCopyText(props.block)}
      initiallyExpanded={props.block.status === "inProgress" || props.block.status === "running"}
    >
      <ImageProtocolContent
        block={props.block}
        {...(props.getTransferAccess === undefined
          ? {}
          : { getTransferAccess: props.getTransferAccess })}
      />
    </Card>
  );
}

export function ImageProtocolContent(props: ImageProtocolContentInput) {
  const gallery = useContext(ArtifactImageReferences);
  const localPath =
    props.block.kind === "imageView"
      ? typeof props.block.raw.path === "string"
        ? props.block.raw.path
        : null
      : typeof props.block.raw.savedPath === "string"
        ? props.block.raw.savedPath
        : null;
  const projectedAsset = privateImageAssetProjection(props.block.raw.codewideAsset);
  const remoteResult = safeImageUri(props.block.raw.result);
  const inGallery =
    props.block.kind === "imageGeneration" &&
    gallery !== null &&
    ((localPath !== null && gallery.has(localPath)) ||
      (projectedAsset !== null && gallery.has(`content:${projectedAsset.id}`)) ||
      (remoteResult !== null && gallery.has(remoteResult)));
  return (
    <>
      {inGallery ? (
        <Text style={styles.menuNotice}>Image attached to this response</Text>
      ) : projectedAsset !== null && props.getTransferAccess !== undefined ? (
        <ScopedPrivateAssetImage
          getTransferAccess={props.getTransferAccess}
          label={props.block.title}
          previewId={props.block.key}
          reference={`private-asset:${projectedAsset.id}`}
          source={{ id: projectedAsset.id, kind: "content" }}
        />
      ) : localPath !== null && props.getTransferAccess !== undefined ? (
        <ScopedRemoteImage
          getTransferAccess={props.getTransferAccess}
          path={localPath}
          previewId={props.block.key}
        />
      ) : remoteResult !== null ? (
        <OpenableImage
          label={props.block.title}
          previewId={props.block.key}
          reference={remoteResult}
          source={{ uri: remoteResult }}
        />
      ) : (
        <Text style={styles.menuNotice}>
          {localPath === null ? "No preview was returned." : `Image · ${basename(localPath)}`}
        </Text>
      )}
      {props.block.kind === "imageGeneration" &&
        typeof props.block.raw.revisedPrompt === "string" && (
          <RichMarkdown source={props.block.raw.revisedPrompt} />
        )}
    </>
  );
}

export function ScopedRemoteImage(props: ScopedRemoteImageInput) {
  return (
    <ScopedPrivateAssetImage
      getTransferAccess={props.getTransferAccess}
      label={`Image ${basename(props.path)}`}
      reference={props.path}
      source={{ kind: "path", path: props.path }}
      {...(props.previewId === undefined ? {} : { previewId: props.previewId })}
      {...(props.groupId === undefined ? {} : { groupId: props.groupId })}
      {...(props.order === undefined ? {} : { order: props.order })}
      {...(props.containerStyle === undefined ? {} : { containerStyle: props.containerStyle })}
    />
  );
}

export function ScopedPrivateAssetImage(props: ScopedPrivateAssetImageInput) {
  const source = props.source;
  const [attempt, setAttempt] = useState(0);
  const downloadDocument = useDocumentDownload();
  const imageContainerStyle = resolveImageContainerStyle(props.containerStyle, styles.userImage);
  const privateImage = usePrivateAssetUri(props.source, {
    access: props.getTransferAccess,
    revision: attempt,
  });
  if (privateImage.failed) {
    return (
      <View style={imageContainerStyle}>
        <Pressable
          accessibilityLabel={`Retry ${props.label}`}
          accessibilityRole="button"
          onPress={() => {
            setAttempt((current) => current + 1);
          }}
        >
          <Text style={styles.menuNotice}>Image preview failed · Retry</Text>
        </Pressable>
      </View>
    );
  }
  if (privateImage.source === null) {
    return (
      <View style={imageContainerStyle}>
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }
  return (
    <OpenableImage
      detail={privateImage.detail}
      label={props.label}
      previewId={props.previewId ?? props.reference}
      reference={props.reference}
      source={privateImage.source}
      variant="user"
      {...(source.kind !== "path"
        ? {}
        : {
            download: async () =>
              downloadDocument({
                getTransferAccess: props.getTransferAccess,
                kind: "image",
                name: basename(source.path),
                path: source.path,
              }),
          })}
      {...(props.groupId === undefined ? {} : { groupId: props.groupId })}
      {...(props.order === undefined ? {} : { order: props.order })}
      {...(props.containerStyle === undefined ? {} : { containerStyle: props.containerStyle })}
      onError={() => {
        setAttempt((current) => current + 1);
      }}
    />
  );
}
