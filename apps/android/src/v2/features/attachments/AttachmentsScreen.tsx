import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { ResourceListView } from "../../../presentation/resources/ResourceListView";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";
import { formatBytes } from "./attachmentDisplay";

interface AttachmentsScreenProps {
  owner: QualifiedThread;
}

export function AttachmentsScreen({ owner }: AttachmentsScreenProps): React.JSX.Element {
  return (
    <V2QueryBoundary
      query={{ kind: "thread.resources", scope: "session", threadId: owner.threadId }}
      savedServerId={owner.savedServerId}
      title="Attachments"
    >
      {(result, refresh) => {
        if (result.kind !== "thread.resources") return null;
        return (
          <>
            <ActionPressable
              action={{ id: "refresh-attachments", label: "Refresh attachments", run: refresh }}
            />
            <ResourceListView
              empty="No attachments in this thread"
              rows={result.attachments.map((attachment) => ({
                detail: `${attachment.mediaType === "" ? "file" : attachment.mediaType} · ${formatBytes(attachment.sizeBytes)}`,
                id: attachment.id,
                label: attachment.name,
              }))}
            />
          </>
        );
      }}
    </V2QueryBoundary>
  );
}
