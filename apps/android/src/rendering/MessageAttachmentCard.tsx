import { Ionicons } from "@expo/vector-icons";
import { useContext } from "react";

import type { GetTransferAccess, PrivateAssetSource } from "../data/private-transfer";
import { useEvent } from "../react/useEvent";
import { colors, iconSize } from "../theme";
import { MessageVideoPreview, useAttachmentVideoPreview } from "./AttachmentVideoPreview";
import { remoteFileKind } from "./document-preview";
import { useDocumentPreview } from "./DocumentPreviewHost";
import { MessageAttachmentTile } from "./MessageAttachmentTile";
import { ThreadCodeDocumentContext } from "./ThreadCodeDocumentContext";
import { attachmentSourceKey, type UserMessageAttachment } from "./user-message-attachments";
import { isAttachmentVideo } from "./videoPreview";

interface MessageAttachmentCardProps {
  readonly attachment: UserMessageAttachment;
  readonly getAccess?: GetTransferAccess;
}

export function MessageAttachmentCard(props: MessageAttachmentCardProps): React.JSX.Element {
  return isAttachmentVideo(props.attachment.name) ? (
    <VideoMessageAttachmentCard {...props} />
  ) : (
    <FileMessageAttachmentCard {...props} />
  );
}

function VideoMessageAttachmentCard({
  attachment,
  getAccess,
}: MessageAttachmentCardProps): React.JSX.Element {
  const openRouteDocument = useContext(ThreadCodeDocumentContext);
  const openVideo = useAttachmentVideoPreview();
  const source = attachmentPrivateSource(attachment);
  const reference = attachmentSourceKey(attachment.source);
  const open = useEvent(() => {
    if (getAccess === undefined) {
      return;
    }
    const request = {
      getTransferAccess: getAccess,
      kind: remoteFileKind(attachment.name, attachment.name),
      name: attachment.name,
      path: attachmentPath(attachment),
      source,
    };
    if (openRouteDocument !== null) {
      openRouteDocument(request);
      return;
    }
    openVideo({ getAccess, name: attachment.name, reference, source });
  });
  if (getAccess === undefined) {
    return (
      <MessageAttachmentTile
        icon={<Ionicons color={colors.accent} name="play-circle-outline" size={iconSize.action} />}
        label="Video"
        name={attachment.name}
      />
    );
  }
  return (
    <MessageVideoPreview
      getAccess={getAccess}
      name={attachment.name}
      onOpen={open}
      reference={reference}
      source={source}
    />
  );
}

function FileMessageAttachmentCard({
  attachment,
  getAccess,
}: MessageAttachmentCardProps): React.JSX.Element {
  const openDocument = useDocumentPreview();
  const openRouteDocument = useContext(ThreadCodeDocumentContext);
  const source = attachmentPrivateSource(attachment);
  const kind = remoteFileKind(attachment.name, attachment.name);
  const open = useEvent(() => {
    if (getAccess === undefined) {
      return;
    }
    const request = {
      getTransferAccess: getAccess,
      kind,
      name: attachment.name,
      path: attachmentPath(attachment),
      source,
    };
    if (openRouteDocument !== null && kind !== "download") {
      openRouteDocument(request);
      return;
    }
    openDocument(request);
  });
  const audio = attachment.kind === "audio";
  return (
    <MessageAttachmentTile
      icon={
        <Ionicons
          color={colors.accent}
          name={audio ? "musical-note-outline" : "document-text-outline"}
          size={iconSize.action}
        />
      }
      label={audio ? "Audio" : kind === "download" ? "File" : kind}
      name={attachment.name}
      {...(attachment.source.type === "content"
        ? { bytes: attachment.source.asset.byteLength }
        : {})}
      {...(getAccess === undefined ? {} : { onOpen: open })}
    />
  );
}

function attachmentPath(attachment: UserMessageAttachment): string {
  return attachment.source.type === "path" || attachment.source.type === "scoped"
    ? attachment.source.path
    : attachment.name;
}

function attachmentPrivateSource(attachment: UserMessageAttachment): PrivateAssetSource {
  const source = attachment.source;
  if (source.type === "path") {
    return { kind: "path", path: source.path };
  }
  if (source.type === "scoped") {
    return { kind: "scoped", path: source.path, rootId: source.rootId };
  }
  if (source.type === "content") {
    return { id: source.asset.id, kind: "content" };
  }
  return { kind: "remote", url: source.url };
}
