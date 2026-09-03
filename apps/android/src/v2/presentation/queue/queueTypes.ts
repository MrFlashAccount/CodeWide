export type QueueDeliveryMode = "sendNow" | "queue" | "steer";

export type QueueRowState = "queued" | "running" | "failed" | "uncertain";

export interface QueueRowAttachmentModel {
  id: string;
  name: string;
}

export interface QueueRowModel {
  attachmentCount: number;
  attachments: QueueRowAttachmentModel[];
  editableText: string;
  error: string | null;
  id: string;
  state: QueueRowState;
  summary: string;
}

export interface QueueRowActions {
  onCancel(itemId: string): Promise<void>;
  onEdit(itemId: string, text: string, attachmentIds?: readonly string[]): Promise<void>;
  onMove(itemId: string, offset: number): Promise<void>;
  onRetry(itemId: string): Promise<void>;
  onSteer(itemId: string): Promise<void>;
}

export type QueuePagingModel =
  | { loadMore(): Promise<void>; status: "complete" | "unavailable" }
  | { loadMore(): Promise<void>; status: "loading" | "ready" }
  | { loadMore(): Promise<void>; message: string; status: "error" };

export interface QueueEditorAttachmentModel {
  error: string | null;
  id: string;
  label: string;
  source: "draft" | "retained";
  state: "error" | "ready" | "uploading";
}

export interface QueueEditorSubmission {
  retainedAttachmentIds: string[];
  text: string;
}
