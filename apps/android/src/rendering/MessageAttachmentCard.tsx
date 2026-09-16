import { Ionicons } from "@expo/vector-icons";
import { MessageAttachmentTile } from "./MessageAttachmentTile";
import { colors, iconSize } from "../theme";
import { isAttachmentVideo, useAttachmentVideoPreview } from "./AttachmentVideoPreview";
import { remoteFileKind } from "./document-preview";
import type { GetTransferAccess, PrivateAssetSource } from "../data/private-transfer";
import { useDocumentPreview } from "./DocumentPreviewHost";
import { useContext } from "react";
import { ThreadCodeDocumentContext } from "./ThreadCodeDocumentContext";
import type { UserMessageAttachment } from "./user-message-attachments";

interface MessageAttachmentCardProps {
  readonly attachment: UserMessageAttachment;
  readonly getAccess?: GetTransferAccess;
}

export function MessageAttachmentCard(props: MessageAttachmentCardProps) {
  const { attachment, getAccess } = props;
  const openDocument = useDocumentPreview();
  const openRouteDocument = useContext(ThreadCodeDocumentContext);
  const openVideo = useAttachmentVideoPreview();
  const video = isAttachmentVideo(attachment.name);
  const source = attachmentPrivateSource(attachment);
  const kind = remoteFileKind(attachment.name, attachment.name);
  const open = () => {
    if (getAccess === undefined) {
      return;
    }
    const request = {
      getTransferAccess: getAccess,
      kind,
      name: attachment.name,
      path:
        attachment.source.type === "path" || attachment.source.type === "scoped"
          ? attachment.source.path
          : attachment.name,
      source,
    };
    if (openRouteDocument !== null && (video || kind !== "download")) {
      openRouteDocument(request);
      return;
    }
    if (video) {
      openVideo({ getAccess, name: attachment.name, source });
      return;
    }
    openDocument(request);
  };
  return (
    <MessageAttachmentTile
      icon={
        <Ionicons
          color={colors.accent}
          name={
            video
              ? "play-circle-outline"
              : attachment.kind === "audio"
                ? "musical-note-outline"
                : "document-text-outline"
          }
          size={iconSize.action}
        />
      }
      label={
        video
          ? "Video"
          : attachment.kind === "audio"
            ? "Audio"
            : kind === "download"
              ? "File"
              : kind
      }
      name={attachment.name}
      {...(attachment.source.type === "content"
        ? { bytes: attachment.source.asset.byteLength }
        : {})}
      {...(getAccess === undefined ? {} : { onOpen: open })}
    />
  );
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
