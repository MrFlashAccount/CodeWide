import type { Dispatch, SetStateAction } from "react";
import type { FileTransferController } from "../../../data/file-transfer-controller";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type { StoredDraftAttachment } from "../../../data/thread-ui-state-types";
import type { QueuedComposerEdit } from "../composerTypes";
import type { useComposerDraftCommands } from "../draft";
import type { ComposerSessionBinding } from "../composerSession";

/** Uploads capture draft mutation and qualified transfer capabilities per activation. */
export type AttachmentAdmissionCapabilities = {
  attachmentCount: number;
  captureDraftMutations: ReturnType<typeof useComposerDraftCommands>["captureDraftMutations"];
  composerScope: string;
  composerSession: ComposerSessionBinding;
  composerUploadScope: string;
  dismissComposerKeyboardForOverlay: () => void;
  draftConnectionId: string | null;
  draftThreadId: string | null;
  fileTransferController: FileTransferController | null;
  getStableTransferAccess: GetTransferAccess;
  getTransferAccess: GetTransferAccess | undefined;
  queuedComposerEdit: QueuedComposerEdit | null;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  upsertDraftAttachment:
    | ((
        connectionId: string,
        threadId: string,
        attachment: StoredDraftAttachment,
        isCurrent: () => boolean,
      ) => Promise<void>)
    | undefined;
};
