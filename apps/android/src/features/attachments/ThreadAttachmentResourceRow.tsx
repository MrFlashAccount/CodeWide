/** V1 ThreadAttachmentResourceRow owner, extracted without changing interaction or resource lifetime. */
import { type ThreadAttachmentResource } from "../../data/workspace-resource-database";
import { remoteFileKind } from "../../rendering/document-preview";
import { AttachmentListRow } from "../../ui/AttachmentListRow";

export function ThreadAttachmentResourceRow({
  attachment,
  position,
  onPress,
}: {
  attachment: ThreadAttachmentResource;
  position: "only" | "first" | "middle" | "last";
  onPress(): void;
}) {
  const icon =
    attachment.kind === "image" ? "image" : attachment.kind === "audio" ? "audio" : "file";
  return (
    <AttachmentListRow
      title={attachment.name}
      description={`${attachment.origin === "user" ? "You" : "Codex"} · ${attachment.kind}`}
      accessibilityLabel={`Open attachment ${attachment.name}`}
      onPress={onPress}
      position={position}
      leading={icon}
      trailing={
        attachment.path === null
          ? "open"
          : remoteFileKind(attachment.name, attachment.path) === "download"
            ? "download"
            : undefined
      }
    />
  );
}
