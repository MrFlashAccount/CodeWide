/** V1 ThreadAttachmentResourceRow owner, extracted without changing interaction or resource lifetime. */
import type { ThreadAttachmentResource } from "../../data/workspace-resource-database";
import { remoteFileKind } from "../../rendering/document-preview";
import { AttachmentListRow } from "../../ui/AttachmentListRow";

export function ThreadAttachmentResourceRow({
  attachment,
  onPress,
  position,
}: {
  attachment: ThreadAttachmentResource;
  onPress: () => void;
  position: "only" | "first" | "middle" | "last";
}) {
  const icon =
    attachment.kind === "image" ? "image" : attachment.kind === "audio" ? "audio" : "file";
  return (
    <AttachmentListRow
      accessibilityLabel={`Open attachment ${attachment.name}`}
      description={`${attachment.origin === "user" ? "You" : "Codex"} · ${attachment.kind}`}
      leading={icon}
      onPress={onPress}
      position={position}
      title={attachment.name}
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
