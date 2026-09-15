import { View } from "react-native";
import { type UserMessageAttachment } from "../../../rendering/user-message-attachments";
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
  getTransferAccess: (() => Promise<{ baseUrl: string; authorization: string }>) | undefined,
) {
  const hero = attachmentCount === 1 || (attachmentCount % 2 === 1 && index === 0);
  const containerStyle = hero ? styles.userImageGalleryHero : styles.userImageGalleryTile;
  const source = attachment.source;
  if (source.type === "content") {
    if (getTransferAccess !== undefined) {
      return (
        <ScopedPrivateAssetImage
          key={source.asset.id}
          previewId={`user-private-image:${source.asset.id}`}
          label={attachment.name}
          reference={`private-asset:${source.asset.id}`}
          source={{ kind: "content", id: source.asset.id }}
          getTransferAccess={getTransferAccess}
          containerStyle={containerStyle}
          order={index}
        />
      );
    }
    return (
      <View key={index} style={[styles.userImage, containerStyle]}>
        <Text style={styles.menuNotice}>Attached image</Text>
      </View>
    );
  }
  if (source.type === "url") {
    return (
      <OpenableImage
        key={source.url}
        previewId={`user-image:${index}:${source.url}`}
        label={attachment.name}
        source={{ uri: source.url }}
        variant="user"
        containerStyle={containerStyle}
        order={index}
        reference={source.url}
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
        key={source.path}
        previewId={`user-local-image:${index}:${source.path}`}
        path={source.path}
        getTransferAccess={getTransferAccess}
        containerStyle={containerStyle}
        order={index}
      />
    );
  }
  if (source.type === "scoped") {
    return getTransferAccess === undefined ? (
      <View key={`${source.rootId}:${source.path}`} style={[styles.userImage, containerStyle]}>
        <Text style={styles.menuNotice}>{attachment.name}</Text>
      </View>
    ) : (
      <ScopedPrivateAssetImage
        key={`${source.rootId}:${source.path}`}
        previewId={`user-scoped-image:${source.rootId}:${source.path}`}
        label={attachment.name}
        reference={`scoped:${source.rootId}:${source.path}`}
        source={{ kind: "scoped", rootId: source.rootId, path: source.path }}
        getTransferAccess={getTransferAccess}
        containerStyle={containerStyle}
        order={index}
      />
    );
  }
  return (
    <View key={index} style={[styles.userImage, containerStyle]}>
      <Text style={styles.menuNotice}>Image preview unavailable</Text>
    </View>
  );
}
