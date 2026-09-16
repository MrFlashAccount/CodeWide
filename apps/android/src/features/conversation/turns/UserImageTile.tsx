import { View } from "react-native";
import type { UserMessageAttachment } from "../../../rendering/user-message-attachments";
import { AppText as Text } from "../../../ui/Typography";
import {
  OpenableImage,
  ScopedPrivateAssetImage,
  ScopedRemoteImage,
} from "../protocol/ImageProtocolBlock";
import { styles } from "./UserMessageContent.styles";

/** Renders one gallery asset while preserving its qualified preview identity. */
export function renderUserImageTile(
  attachment: UserMessageAttachment,
  index: number,
  attachmentCount: number,
  getTransferAccess: (() => Promise<{ authorization: string; baseUrl: string }>) | undefined,
) {
  const hero = attachmentCount === 1 || (attachmentCount % 2 === 1 && index === 0);
  const containerStyle = hero ? styles.userImageGalleryHero : styles.userImageGalleryTile;
  const source = attachment.source;
  if (source.type === "content") {
    if (getTransferAccess !== undefined) {
      return (
        <ScopedPrivateAssetImage
          containerStyle={containerStyle}
          getTransferAccess={getTransferAccess}
          key={source.asset.id}
          label={attachment.name}
          order={index}
          previewId={`user-private-image:${source.asset.id}`}
          reference={`private-asset:${source.asset.id}`}
          source={{ id: source.asset.id, kind: "content" }}
        />
      );
    }
    return (
      <View key={source.asset.id} style={[styles.userImage, containerStyle]}>
        <Text style={styles.menuNotice}>Attached image</Text>
      </View>
    );
  }
  if (source.type === "url") {
    return (
      <OpenableImage
        containerStyle={containerStyle}
        key={source.url}
        label={attachment.name}
        order={index}
        previewId={`user-image:${String(index)}:${source.url}`}
        reference={source.url}
        source={{ uri: source.url }}
        variant="user"
      />
    );
  }
  if (source.type === "path") {
    return getTransferAccess === undefined ? (
      <View key={source.path} style={[styles.userImage, containerStyle]}>
        <Text style={styles.menuNotice}>{attachment.name}</Text>
      </View>
    ) : (
      <ScopedRemoteImage
        containerStyle={containerStyle}
        getTransferAccess={getTransferAccess}
        key={source.path}
        order={index}
        path={source.path}
        previewId={`user-local-image:${String(index)}:${source.path}`}
      />
    );
  }
  return getTransferAccess === undefined ? (
    <View key={`${source.rootId}:${source.path}`} style={[styles.userImage, containerStyle]}>
      <Text style={styles.menuNotice}>{attachment.name}</Text>
    </View>
  ) : (
    <ScopedPrivateAssetImage
      containerStyle={containerStyle}
      getTransferAccess={getTransferAccess}
      key={`${source.rootId}:${source.path}`}
      label={attachment.name}
      order={index}
      previewId={`user-scoped-image:${source.rootId}:${source.path}`}
      reference={`scoped:${source.rootId}:${source.path}`}
      source={{ kind: "scoped", path: source.path, rootId: source.rootId }}
    />
  );
}
