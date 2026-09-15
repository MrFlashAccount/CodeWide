import type { Dispatch, SetStateAction } from "react";
import type { FileTransferController } from "../../../data/file-transfer-controller";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import type { QueuedComposerEdit } from "../composerTypes";
import type { useComposerDraftCommands } from "../draft";

/** Uploads capture draft mutation and qualified transfer capabilities per activation. */
export type AttachmentAdmissionCapabilities = {
  composerScope: string;
  composerUploadScope: string;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  getTransferAccess: GetTransferAccess | undefined;
  getStableTransferAccess: GetTransferAccess;
  queuedComposerEdit: QueuedComposerEdit | null;
  upsertDraftAttachment:
    | ((
        connectionId: string,
        threadId: string,
        attachment: StoredDraftAttachment,
        isCurrent: () => boolean,
      ) => Promise<void>)
    | undefined;
  latestAttachmentsRef: { current: { latest: StoredDraftAttachment[] } };
  captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
  fileTransferController: FileTransferController | null;
  attachmentCount: number;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  dismissComposerKeyboardForOverlay(): void;
};
