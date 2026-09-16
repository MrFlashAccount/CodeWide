import type { TransferAccess } from "../../data/private-transfer";
/** Qualified attachments operations; transport and persisted state stay with their existing lower owners. */
export type AttachmentsWorkspaceCapabilities = {
  transferAccess: (connectionId: string, forceRefresh?: boolean) => Promise<TransferAccess>;
};
