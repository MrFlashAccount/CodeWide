import { View } from "react-native";
import type { UserMessageAttachment } from "../../../rendering/user-message-attachments";
import { AppText as Text } from "../../../ui/Typography";
import {
  OpenableImage,
  ScopedPrivateAssetImage,
  ScopedRemoteImage,
} from "../protocol/ImageProtocolBlock";
import { styles } from "./UserMessageContent.styles";
import { UserImageTileFrame } from "./UserImageTileFrame";

/** Renders one gallery asset while preserving its qualified preview identity. */
export function UserImageTile({
  attachment,
  attachmentCount,
  getTransferAccess,
  index,
}: {
  readonly attachment: UserMessageAttachment;
  readonly attachmentCount: number;
  readonly getTransferAccess:
    | (() => Promise<{ authorization: string; baseUrl: string }>)
    | undefined;
  readonly index: number;
}) {
  const hero = attachmentCount === 1;
  const content = renderUserImageTileContent({
    attachment,
    getTransferAccess,
    index,
  });
  return <UserImageTileFrame layout={hero ? "hero" : "tile"}>{content}</UserImageTileFrame>;
}

function renderUserImageTileContent({
  attachment,
  getTransferAccess,
  index,
}: {
  readonly attachment: UserMessageAttachment;
  readonly getTransferAccess:
    | (() => Promise<{ authorization: string; baseUrl: string }>)
    | undefined;
  readonly index: number;
}) {
  const source = attachment.source;
  if (source.type === "content") {
    if (getTransferAccess !== undefined) {
      return (
        <ScopedPrivateAssetImage
          containerStyle={styles.userImageFill}
          getTransferAccess={getTransferAccess}
          label={attachment.name}
          order={index}
          previewId={`user-private-image:${source.asset.id}`}
          reference={`private-asset:${source.asset.id}`}
          source={{ id: source.asset.id, kind: "content" }}
        />
      );
    }
    return (
      <View style={styles.userImageFill}>
        <Text style={styles.menuNotice}>Attached image</Text>
      </View>
    );
  }
  if (source.type === "url") {
    return (
      <OpenableImage
        containerStyle={styles.userImageFill}
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
      <View style={styles.userImageFill}>
        <Text style={styles.menuNotice}>{attachment.name}</Text>
      </View>
    ) : (
      <ScopedRemoteImage
        containerStyle={styles.userImageFill}
        getTransferAccess={getTransferAccess}
        order={index}
        path={source.path}
        previewId={`user-local-image:${String(index)}:${source.path}`}
      />
    );
  }
  return getTransferAccess === undefined ? (
    <View style={styles.userImageFill}>
      <Text style={styles.menuNotice}>{attachment.name}</Text>
    </View>
  ) : (
    <ScopedPrivateAssetImage
      containerStyle={styles.userImageFill}
      getTransferAccess={getTransferAccess}
      label={attachment.name}
      order={index}
      previewId={`user-scoped-image:${source.rootId}:${source.path}`}
      reference={`scoped:${source.rootId}:${source.path}`}
      source={{ kind: "scoped", path: source.path, rootId: source.rootId }}
    />
  );
}
