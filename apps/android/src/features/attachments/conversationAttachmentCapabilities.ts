import type { FileTransferController } from "../../data/file-transfer-controller";
import type { GetTransferAccess } from "../../data/private-transfer";
/** Qualified capabilities consumed by the attachments owner in conversation composition. */
export type ConversationAttachmentCapabilities = {
  fileTransferController: FileTransferController | null;
  getTransferAccess: GetTransferAccess | undefined;
};
