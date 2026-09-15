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
  const openCodeDocument = useContext(ThreadCodeDocumentContext);
  const openVideo = useAttachmentVideoPreview();
  const video = isAttachmentVideo(attachment.name);
  const source = attachmentPrivateSource(attachment);
  const kind = remoteFileKind(attachment.name, attachment.name);
  const open = () => {
    if (getAccess === undefined) return;
    if (video) {
      openVideo({ name: attachment.name, source, getAccess });
      return;
    }
    const openPreview =
      kind === "text" && openCodeDocument !== null ? openCodeDocument : openDocument;
    openPreview({
      kind,
      name: attachment.name,
      path:
        attachment.source.type === "path" || attachment.source.type === "scoped"
          ? attachment.source.path
          : attachment.name,
      source,
      getTransferAccess: getAccess,
    });
  };
  return (
    <MessageAttachmentTile
      name={attachment.name}
      label={
        video
          ? "Video"
          : attachment.kind === "audio"
            ? "Audio"
            : kind === "download"
              ? "File"
              : kind
      }
      icon={
        <Ionicons
          name={
            video
              ? "play-circle-outline"
              : attachment.kind === "audio"
                ? "musical-note-outline"
                : "document-text-outline"
          }
          size={iconSize.action}
          color={colors.accent}
        />
      }
      {...(attachment.source.type === "content"
        ? { bytes: attachment.source.asset.byteLength }
        : {})}
      {...(getAccess === undefined ? {} : { onOpen: open })}
    />
  );
}

function attachmentPrivateSource(attachment: UserMessageAttachment): PrivateAssetSource {
  const source = attachment.source;
  if (source.type === "path") return { kind: "path", path: source.path };
  if (source.type === "scoped") return { kind: "scoped", rootId: source.rootId, path: source.path };
  if (source.type === "content") return { kind: "content", id: source.asset.id };
  return { kind: "remote", url: source.url };
}
