import { composerUploads } from "../../data/composer-uploads";
import { newThreadService, type NewThreadDraft } from "../../services/threads/newThreadService";
import type { ComposerWorkspaceCapabilities } from "../composer/workspaceCapabilities";
import type { ProjectDestination } from "./projectPickerContract";

/** Preserves draft text before changing its server; server-owned attachments cannot cross hosts. */
export async function changeNewChatDestination({
  composer,
  destination,
  draft,
}: {
  readonly composer: Pick<
    ComposerWorkspaceCapabilities,
    "loadDraft" | "loadDraftAttachments" | "saveDraft"
  >;
  readonly destination: ProjectDestination;
  readonly draft: NewThreadDraft;
}): Promise<void> {
  if (newThreadService.current() !== draft) {
    return;
  }
  if (draft.connectionId !== destination.connectionId) {
    const [text, attachments] = await Promise.all([
      composer.loadDraft(draft.connectionId, draft.id),
      composer.loadDraftAttachments(draft.connectionId, draft.id),
    ]);
    if (
      attachments.length > 0 ||
      composerUploads.entries(`${draft.connectionId}\u0000${draft.id}`).length > 0
    ) {
      throw new Error(
        "Remove attached files before changing servers. Uploaded files belong to the current server.",
      );
    }
    if (newThreadService.current() !== draft) {
      return;
    }
    await composer.saveDraft(destination.connectionId, draft.id, text);
  }
  newThreadService.changeDestination(draft, destination);
}
