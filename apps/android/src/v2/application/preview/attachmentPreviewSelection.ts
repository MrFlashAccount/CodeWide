import type { V2Attachment } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";

export interface AttachmentPreviewSelection {
  attachments: readonly V2Attachment[];
  selectedId: string;
}

/** Holds only the presentation payload needed by the next attachment route.
 * Server projection ownership remains with the Sync V2 session. */
export class AttachmentPreviewSelections {
  readonly #selections = new Map<string, AttachmentPreviewSelection>();

  present(
    owner: QualifiedThread,
    attachments: readonly V2Attachment[],
    selected: V2Attachment,
  ): void {
    const available = attachments.some((attachment) => attachment.id === selected.id)
      ? attachments
      : [selected];
    this.#selections.set(selectionKey(owner, selected.id), {
      attachments: available,
      selectedId: selected.id,
    });
  }

  selection(owner: QualifiedThread, attachmentId: string): AttachmentPreviewSelection | null {
    return this.#selections.get(selectionKey(owner, attachmentId)) ?? null;
  }

  deleteSavedServer(savedServerId: string): void {
    const prefix = `${savedServerId}\u0000`;
    for (const key of this.#selections.keys()) {
      if (key.startsWith(prefix)) this.#selections.delete(key);
    }
  }
}

function selectionKey(owner: QualifiedThread, attachmentId: string): string {
  return `${owner.savedServerId}\u0000${owner.threadId}\u0000${attachmentId}`;
}
